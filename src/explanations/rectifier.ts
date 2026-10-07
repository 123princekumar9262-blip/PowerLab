import { sampleAt } from '../simulation/engine.ts'
import { sineSource } from '../simulation/source.ts'
import type { CircuitEvent, DiodeBias, DiodeId, SimulationResult, SimulationSample } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import { trendAt, type Trend } from './trend.ts'
import type { FreewheelInsight } from './freewheel.ts'
import { firingInsight, type FiringInsight } from './firing.ts'
import { deviceName } from '../circuits/devices.ts'

/** Stages of the causal chain, in the order the physics happens. */
export type CausalStage = 'source' | 'condition' | 'diode' | 'inductor' | 'freewheel' | 'path' | 'energy' | 'output' | 'waveform'

export interface CausalStep {
  stage: CausalStage
  title: string
  text: string
  /** The equation that describes this stage (shown by the Physics Lens). */
  equation?: string
}

/** Three-phase specifics of the state at the cursor (all read from the simulation). */
export interface ThreePhaseInsight {
  phases: { a: number; b: number; c: number }
  /** Phases ordered from highest to lowest instantaneous voltage. */
  order: Array<'a' | 'b' | 'c'>
  /** Conducting devices, upper (to the + rail) and lower (from the − rail / neutral). */
  upper: string[]
  lower: string[]
  /** e.g. "D1 & D6" — the conducting pair (or set, during overlap). */
  pairLabel: string
  /** e.g. "Phase A → D1 → Load → D6 → Phase B". */
  pathText: string
  /** e.g. "Vo = Vab − 2·Vf". */
  outputRelation: string
  /** Value of that relation from the source EMFs (should equal the simulated Vo). */
  outputFromSource: number
  /** 60°/120° segment index, conduction region label. */
  region: string
  overlap: boolean
  freewheeling: boolean
  /** Display name per device id (SCRs are shown as T1…T6). */
  names: Record<string, string>
}

export interface StateExplanation {
  sample: SimulationSample
  /** Source electrical angle θ = ωt + φ, in [0°, 360°). */
  angleDeg: number
  /** 1-based source cycle the instant belongs to. */
  cycle: number
  source: { polarity: 'positive' | 'negative' | 'zero'; trend: Trend; text: string }
  /** D1 (the reference diode) — plus every diode in `diodes`. */
  diode: { on: boolean; bias: DiodeBias; text: string }
  diodes: Array<{ id: DiodeId; on: boolean; bias: DiodeBias }>
  current: { flowing: boolean; trend: 'increasing' | 'decreasing' | 'at peak' | 'zero'; text: string }
  output: { conducting: boolean; text: string }
  /** Conduction path element names, or null when no current flows anywhere. */
  path: string[] | null
  headline: string
  /** One-paragraph answer to "why is this happening?" */
  summary: string
  chain: CausalStep[]
  threePhase?: ThreePhaseInsight
  /** Freewheeling-diode circuits: Dfw state, inductor energy, why Dfw is ON/OFF. */
  freewheel?: FreewheelInsight
  /** Controlled rectifiers: each SCR's state, why it is OFF, why it turned ON. */
  firing?: FiringInsight
  /** Display name per device id (SCRs are T1, T2…). */
  names?: Record<string, string>
}

const V = (v: number) => formatV(v)

/**
 * Explain the circuit state at one sample, for any rectifier × load. Everything is read
 * from the simulation result; the text is assembled from that state, never canned per time.
 */
export function explainState(result: SimulationResult, index: number): StateExplanation {
  const { params: p, trace } = result
  const s = sampleAt(result, index)
  const i = s.index
  const x = s.values
  const topo = p.topology
  const load = p.load
  const hasL = load === 'RL' || load === 'RLC'
  const hasC = load === 'RC' || load === 'RLC'
  const ideal = p.diode.kind === 'ideal'
  const vf = p.diode.vf
  const vfText = ideal ? '0 V (ideal)' : formatSI(vf, 'V')
  const vftText = topo === 'bridge' && !ideal ? `2·Vf = ${formatSI(2 * vf, 'V')}` : `Vf = ${vfText}`
  const source = sineSource(p)
  const angleDeg = source.angleDeg(s.time)
  const theta = formatDeg(angleDeg)
  const cycle = Math.min(p.cycles, Math.floor(s.time / p.period) + 1)

  const vin = x.vin ?? 0
  const vout = x.vout ?? 0
  const io = x.io ?? 0
  const il = x.il ?? (load === 'RL' ? io : 0)
  const ic = x.ic ?? 0
  const vl = x.vl ?? 0
  const vC = hasC ? vout : 0
  const on = s.diodes.filter((d) => d.on).map((d) => d.id)
  const anyOn = on.length > 0
  const nm = (id: string) => deviceName(p, id as DiodeId)
  const fire = firingInsight(result, s)

  // Trends from neighbouring samples
  const vinTrend = trendAt(trace.time, trace.signals.vin!, i, p.omega * p.vm)
  // Current scale for the trend test: largest |io| in the first two cycles (a loop — the
  // trace can hold 400 000 samples, too many to spread into Math.max).
  let ioScale = 1e-300
  const ioArr = trace.signals.io!
  for (let k = 0, kEnd = Math.min(trace.length, 1 + Math.ceil((2 * p.period) / p.dt)); k < kEnd; k++) ioScale = Math.max(ioScale, Math.abs(ioArr[k]))
  const ioTrendRaw = trendAt(trace.time, trace.signals.io!, i, p.omega * ioScale)
  const flowing = Math.abs(io) > 0 || anyOn
  const currentTrend: StateExplanation['current']['trend'] = !flowing || io === 0 ? 'zero' : ioTrendRaw === 'rising' ? 'increasing' : ioTrendRaw === 'falling' ? 'decreasing' : 'at peak'
  const polarity = vin > 0 ? 'positive' : vin < 0 ? 'negative' : 'zero'
  const trendWords: Record<Trend, string> = { rising: 'and rising', falling: 'and falling', peak: '— at its positive peak', trough: '— at its negative peak', flat: '' }

  // ── SOURCE ─────────────────────────────────────────────────────────────────────
  let sourceText =
    polarity === 'zero'
      ? `Vin = 0 V (θ = ${theta}) — the source is crossing zero.`
      : `Vin = ${V(vin)} ${trendWords[vinTrend]} (θ = ${theta}, ${polarity} half-cycle).`.replace('  ', ' ')
  if (topo === 'center-tap') sourceText += ` The two half-windings sit at +vin and −vin relative to the center tap, so one diode anode is always the positive one.`
  if (topo === 'bridge') sourceText += ` Bridge terminal "a" is ${polarity === 'negative' ? 'negative' : 'positive'} with respect to "b".`

  // ── Which diodes conduct, and why ──────────────────────────────────────────────
  const pairText = on.length === 0 ? (fire ? 'no device' : 'no diode') : on.map(nm).join(' and ')
  let conditionText = ''
  let pathNodes: string[] | null = null
  const loadNode = load === 'R' ? 'R' : load === 'RL' ? 'L → R' : load === 'RC' ? 'C ∥ R' : 'L → C ∥ R'

  if (anyOn) {
    if (topo === 'half-wave') pathNodes = ['Source (+)', nm('D1'), ...loadNode.split(' → '), 'Source (−)']
    else if (topo === 'center-tap') pathNodes = on.includes('D1') ? ['Upper winding (+vin)', nm('D1'), ...loadNode.split(' → '), 'Center tap'] : ['Lower winding (−vin)', nm('D2'), ...loadNode.split(' → '), 'Center tap']
    else if (on.length === 4) pathNodes = ['Load', `${nm('D3')} ∥ ${nm('D4')}`, `${nm('D1')} ∥ ${nm('D2')}`, 'Load (freewheeling)']
    else if (on.includes('D1') && on.includes('D3')) pathNodes = ['Load', nm('D3'), nm('D1'), 'Load (freewheeling)']
    else if (on.includes('D2') && on.includes('D4')) pathNodes = ['Load', nm('D4'), nm('D2'), 'Load (freewheeling)']
    else pathNodes = on.includes('D1') ? ['Terminal a (+)', nm('D1'), ...loadNode.split(' → '), nm('D4'), 'Terminal b'] : ['Terminal b (+)', nm('D2'), ...loadNode.split(' → '), nm('D3'), 'Terminal a']
  } else if (hasC && Math.abs(io) > 0) {
    pathNodes = ['C (discharging)', 'R', 'C']
  }

  // Inductor holding a diode ON against the source?
  const lHolding = hasL && anyOn && il > 0 && vl < 0 && vin * (on.includes('D2') && topo !== 'half-wave' ? -1 : 1) < (topo === 'bridge' ? 2 * vf : vf)
  if (anyOn) {
    if (lHolding) {
      conditionText =
        `The source alone would no longer forward bias ${pairText} — but the inductor current iL = ${formatA(il)} cannot change instantly. ` +
        `To keep it flowing the inductor reverses its voltage (vL = L·di/dt = ${V(vl)}), acting as a source that holds ${pairText} ON. A diode only turns off when its current reaches zero.`
    } else if (hasC && !hasL) {
      conditionText = `The rectified source voltage minus ${vftText} exceeds the capacitor voltage vC = ${V(vC)}. Assume ${pairText} OFF: the anode would then sit above the cathode by more than Vf — impossible — so ${pairText} conducts and the source recharges C while also feeding R.`
    } else if (topo === 'half-wave') {
      conditionText = `Test "D1 OFF": with no current the full Vin = ${V(vin)} would sit across D1, anode positive, exceeding Vf = ${vfText} — impossible for a blocking diode. So D1 conducts.`
    } else if (topo === 'center-tap') {
      conditionText = `${on[0]}'s anode is on the winding end that is positive (${on[0] === 'D1' ? 'upper, +vin' : 'lower, −vin'} = ${V(on[0] === 'D1' ? vin : -vin)}), higher than the output node by more than Vf, so it conducts. The other diode's anode is at the opposite winding end — far below the output — so it is reverse biased.`
    } else {
      conditionText =
        on.length === 2 && ((on.includes('D1') && on.includes('D4')) || (on.includes('D2') && on.includes('D3')))
          ? `With terminal ${on.includes('D1') ? 'a' : 'b'} positive, current can only take the path through ${pairText} — they conduct as a pair, each dropping Vf. The other pair sees the output voltage in reverse and blocks.`
          : `${pairText} conduct together: the load current freewheels through the bridge legs because |vin| is too small to drive either diagonal pair alone.`
    }
  } else {
    if (hasC && vC > 0) {
      conditionText = `The capacitor holds vC = ${V(vC)}. That keeps every diode's cathode above its anode by more than the source can overcome (|vin| − ${vftText} < vC). Assume a diode ON: it would need current flowing backwards into the source — impossible. So all diodes are OFF.`
    } else if (hasL && s.time > 0 && vin < 0) {
      conditionText = `The inductor current has fallen to zero (its stored energy is spent), so nothing holds the diode on. With Vin = ${V(vin)} the diode would need reverse current — impossible. All diodes are OFF.`
    } else if (polarity === 'zero') {
      conditionText = 'Vin = 0: nothing drives current, so no diode can be forward biased.'
    } else {
      conditionText = `|Vin| = ${V(Math.abs(vin))} is below ${vftText}. Assume a diode ON: KVL would need current flowing backwards through it — impossible. So all diodes are OFF${ideal ? '' : ' (the real-diode "dead zone")'}.`
    }
  }

  // Controlled rectifiers: the SCR's own conditions (forward bias AND gate) decide.
  if (fire) {
    const diodesText = s.diodes.filter((d) => d.id !== 'Dfw' && !fire.scrs.some((x) => x.id === d.id)).map((d) => `${nm(d.id)} ${d.on ? 'ON' : 'OFF'} (diode, vD = ${V(d.voltage)})`)
    conditionText = [...fire.scrs.map((x) => x.text), diodesText.length ? `Diodes: ${diodesText.join('; ')}.` : ''].filter(Boolean).join(' ') + (lHolding ? ` ${conditionText}` : '')
  }

  // ── DIODE ──────────────────────────────────────────────────────────────────────
  const biasLabel = (b: DiodeBias) => (b === 'forward-conducting' ? 'conducting' : b === 'forward-below-threshold' ? 'forward, below Vf' : b === 'reverse' ? 'reverse biased' : 'zero bias')
  const diodeText = s.diodes.map((d) => `${nm(d.id)} ${d.on ? 'ON' : 'OFF'} (${biasLabel(d.bias)}, vD = ${V(d.voltage)})`).join('; ') + '.'
  const blockMax = Math.max(0, ...s.diodes.filter((d) => !d.on).map((d) => -d.voltage))
  const diodeDetail = anyOn
    ? `${diodeText} A conducting ${ideal ? 'ideal diode is a closed switch (vD = 0)' : `real diode holds about Vf${p.diode.ron > 0 ? ' + Ron·iD' : ''}`}.` + (blockMax > 0 ? ` The blocking diode(s) hold up to ${V(-blockMax)} in reverse.` : '')
    : `${diodeText} The source voltage appears across the diodes instead of the load.`

  // ── PATH ───────────────────────────────────────────────────────────────────────
  let pathText: string
  if (anyOn && pathNodes) {
    pathText = `Current flows ${pathNodes.join(' → ')}. ` + (hasC ? `At the output node it splits: iC = ${formatA(ic, true)} into the capacitor, io = ${formatA(io)} through R.` : `It is a single series loop, so io = ${formatA(io)} everywhere${hasL ? ' (including through L)' : ''}.`)
  } else if (pathNodes) {
    pathText = `No current comes from the source. The capacitor discharges through the load: iC = ${formatA(ic, true)} (negative = flowing out of C), io = ${formatA(io)} through R.`
  } else {
    pathText = 'No current flows anywhere — the loop is open at the diodes.'
  }

  // ── ENERGY ─────────────────────────────────────────────────────────────────────
  const parts: string[] = []
  const ps = x.ps ?? 0
  parts.push(anyOn ? `The source delivers ${formatW(ps)}.` : 'The source delivers nothing.')
  if (hasL) {
    const pL = vl * il
    parts.push(
      il > 0
        ? `L stores ½·L·iL² = ${formatSI(x.wl ?? 0, 'J')} and is ${pL > 0 ? `absorbing ${formatW(pL)} (building its magnetic field)` : `returning ${formatW(-pL)} to the circuit`}.`
        : 'L stores no energy (iL = 0).',
    )
  }
  if (hasC) {
    const pC = vC * ic
    parts.push(`C stores ½·C·vC² = ${formatSI(x.wc ?? 0, 'J')} and is ${pC >= 0 ? `charging at ${formatW(pC)}` : `discharging, supplying ${formatW(-pC)}`}.`)
  }
  parts.push(`R dissipates ${formatW(x.pload ?? 0)} as heat${anyOn && !ideal ? `; the diodes lose ${formatW(x.pd ?? 0)}` : ''}.`)
  if (!hasL && !hasC) parts.push('A resistor stores no energy — power in equals power out at every instant.')
  const energyText = parts.join(' ')

  // ── OUTPUT ─────────────────────────────────────────────────────────────────────
  let outputText: string
  if (load === 'R') outputText = anyOn ? `Vout = io·R = ${V(vout)} = |vin| − (diode drops).` : 'Vout = io·R = 0 V.'
  else if (load === 'RL') outputText = anyOn ? `Vout (across R + L) = R·io + vL = ${V(io * p.resistance)} + ${V(vl)} = ${V(vout)}.` : 'Vout = 0 V (no current, no di/dt).'
  else if (load === 'RC') outputText = `Vout = vC = ${V(vout)}, set by the capacitor's charge; io = vC/R = ${formatA(io)}.`
  else outputText = `The rectifier output vrect = ${V(x.vrect ?? 0)}; the inductor drops vL = ${V(vl)}; the load sees vC = ${V(vout)}.`

  // ── WAVEFORM ───────────────────────────────────────────────────────────────────
  let waveformText: string
  const tauRC = p.resistance * p.capacitance
  if (load === 'R') {
    waveformText = anyOn
      ? `Vout follows |vin| minus the diode drop, and Io has the same shape (Io = Vout/R) — a resistor responds instantly.`
      : `Vout and Io are flat at zero; Vd takes the source voltage.`
  } else if (load === 'RL') {
    waveformText = !anyOn
      ? 'Vout and Io are zero until a diode turns on again.'
      : lHolding
        ? `Vin is below the diode drop, yet the current continues — so Vout follows vin ${vin < 0 ? 'below zero (the negative area that lowers Vdc)' : 'down'} until iL reaches zero${topo === 'half-wave' ? ' at the extinction angle β' : ' or the other diodes take over'}.`
        : `Io lags vin: the inductor slows every change in current (time constant L/R = ${formatTime(p.inductance / p.resistance)}), so the current peak comes after the voltage peak.`
  } else if (load === 'RC') {
    waveformText = anyOn
      ? `Charging pulse: Vout rides up with |vin|. The diode current (iC + io) is large and brief — the capacitor is refilled in a fraction of the cycle.`
      : `Hold-up: C discharges through R, so Vout decays exponentially (RC = ${formatTime(tauRC)}). This droop between charging pulses IS the ripple.`
  } else {
    waveformText = anyOn
      ? `The inductor resists changes in current and the capacitor resists changes in voltage, so iL and Vout stay much smoother than the rectified vrect.`
      : `iL has fallen to zero (discontinuous mode); C alone supplies R until the next conduction.`
  }

  // ── Headline & summary ─────────────────────────────────────────────────────────
  let headline: string
  let summary: string
  if (anyOn) {
    headline = lHolding ? `${pairText} ON — held on by the inductor` : `${pairText} ON — ${hasC && !hasL ? 'recharging C' : 'current flows to the load'}`
    summary = lHolding
      ? `The source is no longer pushing forward, but the inductor's stored energy keeps ${formatA(il)} flowing through ${pairText}, so Vout = ${V(vout)}.`
      : `${pairText} ${on.length > 1 ? 'are' : 'is'} forward biased by the source, so current flows ${pathNodes?.join(' → ')}. Vout = ${V(vout)}, Io = ${formatA(io)}.`
  } else if (hasC && Math.abs(io) > 0) {
    headline = 'All diodes OFF — the capacitor feeds the load'
    summary = `The capacitor voltage (${V(vC)}) is above what the source can reach through the diodes, so they block. C supplies R: Vout decays from its peak — the ripple.`
  } else if (fire && fire.scrs.some((x) => x.state === 'blocking-forward')) {
    const x = fire.scrs.find((y) => y.state === 'blocking-forward')!
    headline = `${x.name} OFF — forward biased, waiting for its gate (α = ${formatDeg(fire.alphaDeg)})`
    summary = `${x.name} has vAK = ${V(x.voltage)} across it but has not been fired yet: an SCR blocks forward voltage until its gate pulse arrives, α = ${formatDeg(fire.alphaDeg)} after its natural point. Until then Io = ${formatA(io)}, Vout = ${V(vout)}.`
  } else if (topo === 'half-wave' && s.bias === 'forward-below-threshold') {
    headline = 'D1 OFF — Vin is below Vf'
    summary = `Vin is positive (${V(vin)}) but below the diode's forward voltage Vf = ${vfText}, so the diode cannot conduct yet. Io = 0, Vout = ${V(vout)}.`
  } else {
    headline = polarity === 'negative' && topo === 'half-wave' ? `${nm('D1')} OFF — reverse biased, blocking` : fire ? 'All devices OFF — no current' : 'All diodes OFF — no current'
    summary =
      polarity === 'negative' && topo === 'half-wave'
        ? `Vin is negative (${V(vin)}), so the diode is reverse biased. It blocks current, therefore Io = 0 and the output voltage is 0 V; the diode itself holds the full ${V(s.vd)}.`
        : `|Vin| is too small to forward bias the diodes (below ${vftText})${hasL ? ' and the inductor current is zero' : ''}. Io = 0, Vout = ${V(vout)}.`
  }

  return {
    sample: s,
    angleDeg,
    cycle,
    source: { polarity, trend: vinTrend, text: sourceText },
    diode: { on: s.diodes[0].on, bias: s.diodes[0].bias, text: diodeDetail },
    diodes: s.diodes.map((d) => ({ id: d.id, on: d.on, bias: d.bias })),
    firing: fire ?? undefined,
    names: Object.fromEntries(s.diodes.map((d) => [d.id, nm(d.id)])),
    current: { flowing: anyOn || Math.abs(io) > 0, trend: currentTrend, text: pathText },
    output: { conducting: Math.abs(io) > 0, text: outputText },
    path: pathNodes,
    headline,
    summary,
    chain: [
      { stage: 'source', title: 'Source', text: sourceText },
      { stage: 'condition', title: 'Circuit condition', text: conditionText },
      { stage: 'diode', title: 'Diode states', text: diodeDetail },
      { stage: 'path', title: 'Current path', text: pathText },
      { stage: 'energy', title: 'Energy', text: energyText },
      { stage: 'output', title: 'Output', text: outputText },
      { stage: 'waveform', title: 'Waveform', text: waveformText },
    ],
  }
}

export interface EventExplanation {
  title: string
  what: string
  why: string
}

const EVENT_TITLES: Record<CircuitEvent['kind'], string> = {
  'vin-positive-peak': 'Vin positive peak',
  'vin-negative-peak': 'Vin negative peak',
  'vin-zero-rising': 'Vin crosses zero ↑',
  'vin-zero-falling': 'Vin crosses zero ↓',
  'diode-on': 'turns ON',
  'diode-off': 'turns OFF',
  'current-start': 'Current starts',
  'current-stop': 'Current stops',
  'vout-max': 'Vout crest',
  'vout-min': 'Vout valley',
  'phase-crossing': 'Phase voltages cross',
  'current-transfer': 'takes over the current',
  'energy-min': 'Inductor energy minimum',
  'commutation-start': 'commutation begins',
  'commutation-end': 'fully conducting (commutation ends)',
}

/** Event title; `names` maps device ids to display names (SCRs shown as T1…). */
export function eventTitle(e: CircuitEvent, names?: Record<string, string>): string {
  return e.device ? `${names?.[e.device] ?? e.device} ${EVENT_TITLES[e.kind]}` : EVENT_TITLES[e.kind]
}

const isScrDev = (p: SimulationResult['params'], id: DiodeId) => deviceName(p, id) !== id

/** Explain a detected event using the circuit solution at the event instant. */
export function explainEvent(result: SimulationResult, e: CircuitEvent): EventExplanation {
  const p = result.params
  const ideal = p.diode.kind === 'ideal'
  const vf = p.diode.vf
  const topo = p.topology
  const load = p.load
  const hasL = load === 'RL' || load === 'RLC'
  const hasC = load === 'RC' || load === 'RLC'
  const thetaDeg = sineSource(p).angleDeg(e.time)
  const at = `at t = ${formatTime(e.time)} (θ = ${formatDeg(thetaDeg)})`
  const v = e.values
  const title = eventTitle(e)
  const vft = topo === 'bridge' ? 2 * vf : vf
  const partner = topo === 'bridge' ? (e.device === 'D1' ? ' together with D4' : e.device === 'D2' ? ' together with D3' : e.device === 'D4' ? ' together with D1' : e.device === 'D3' ? ' together with D2' : '') : ''

  const scrEvent = e.device ? isScrDev(p, e.device) : false
  switch (e.kind) {
    case 'diode-on':
      if (scrEvent)
        return {
          title: `${deviceName(p, e.device!)} fired — turns ON`,
          what: `${deviceName(p, e.device!)} starts conducting ${at}. Vin = ${formatV(v.vin ?? 0)}.`,
          why: `An SCR needs two things: forward bias AND a gate pulse. Its gate is fired α = ${formatDeg((p.control.alpha * 180) / Math.PI)} after its natural point; it was forward biased then, so it latched ON${(v.io ?? 0) > 1e-9 ? ' and took over the load current from the previous devices' : ''}.`,
        }
      return {
        title,
        what: `${e.device} switches from blocking to conducting${partner} ${at}. Vin = ${formatV(v.vin ?? 0)}${hasC ? `, Vout = ${formatV(v.vout ?? 0)}` : ''}.`,
        why: hasC && !hasL
          ? `The rising source, minus ${topo === 'bridge' ? 'two diode drops' : 'the diode drop'}, has just caught up with the capacitor voltage. From here it can push charge into C — this is the start of the charging pulse.`
          : (v.il ?? 0) > 0 && topo !== 'half-wave'
            ? `Commutation: vin has changed sign, so ${e.device}'s side of the source is now the positive one. The inductor current (${formatA(v.il ?? v.io ?? 0)}) transfers instantly to ${e.device}${partner}.`
            : ideal
              ? 'An ideal diode conducts for any positive anode-to-cathode voltage. As soon as its side of the source turns positive, staying OFF would leave a forward voltage across a blocking diode — impossible — so it turns ON.'
              : `The source has risen to ${topo === 'bridge' ? '2·Vf' : 'Vf'} = ${formatSI(vft, 'V')} on this diode's side. Below that it was forward biased but not enough to overcome the junction(s); above it, staying OFF is impossible.`,
      }
    case 'diode-off':
      return {
        title,
        what: `${e.device} stops conducting${partner} ${at}. Vin = ${formatV(v.vin ?? 0)}${hasL ? `, iL = ${formatA(v.il ?? v.io ?? 0)}` : ''}.`,
        why: hasL && topo === 'half-wave'
          ? `Extinction: the inductor has used up its stored energy, so the current has fallen to zero. A diode cannot carry reverse current, so D1 turns OFF here — well after vin crossed zero. This angle is the extinction angle β.`
          : hasC && !hasL
            ? `The source is now falling faster than the capacitor would discharge through R on its own. The diode current (iC + io) has dropped to zero, so the diode turns OFF and C takes over supplying the load.`
            : hasL
              ? `vin changed sign, so the other side of the rectifier now offers the forward path; the current commutates away from ${e.device} (or, in discontinuous mode, simply reaches zero).`
              : ideal
                ? `In a resistive circuit the current is vin/R, so it reaches zero exactly when vin does. Staying ON would need negative current, so the diode turns OFF.`
                : `Vin has fallen back to ${topo === 'bridge' ? '2·Vf' : 'Vf'}; the current (|vin| − drops)/R reaches zero, so the diode turns OFF slightly before vin crosses zero.`,
      }
    case 'current-start':
      return {
        title,
        what: `The rectifier starts delivering current ${at}.`,
        why: `Current can only come from the source once a diode conducts, so this coincides with the turn-on. It starts from zero${hasL ? ' and the inductor makes it rise gradually (L·di/dt limits the slope)' : hasC ? ' and jumps to the capacitor\'s charging current' : ''}.`,
      }
    case 'current-stop':
      return {
        title,
        what: `The rectifier stops delivering current ${at}.`,
        why: hasC
          ? 'From here until the next charging pulse the capacitor alone supplies the load.'
          : hasL
            ? 'The inductor has no stored energy left, so nothing keeps current flowing; output current stays zero until the next turn-on.'
            : 'Nothing in this circuit stores energy, so there is nothing to keep current flowing once the source stops driving it forward.',
      }
    case 'vin-positive-peak':
      return {
        title,
        what: `Vin reaches its maximum Vm = ${formatV(v.vin ?? 0)} ${at}. Vout = ${formatV(v.vout ?? 0)}.`,
        why: load === 'R'
          ? 'A resistive load responds instantly, so Vout and Io peak at the same moment.'
          : hasC && !hasL
            ? 'The capacitor charges up to about Vm − Vf here; after the peak the source falls and C soon stops charging.'
            : 'With an inductor the current keeps rising a little after the voltage peak — it lags the voltage.',
      }
    case 'vin-negative-peak':
      return {
        title,
        what: `Vin reaches −Vm = ${formatV(v.vin ?? 0)} ${at}.`,
        why: topo === 'half-wave'
          ? `D1 must block this — plus${hasC ? ' the capacitor voltage on its cathode, giving a PIV close to 2Vm' : ' nothing else, so PIV = Vm'}.`
          : topo === 'center-tap'
            ? 'For the center-tap, the blocking diode sees vin from its own winding plus the output voltage: PIV ≈ 2Vm.'
            : 'In the bridge, each blocking diode sees about Vm — half the center-tap\'s requirement.',
      }
    case 'vin-zero-rising':
    case 'vin-zero-falling':
      return {
        title,
        what: `Vin changes sign ${at}.`,
        why: hasL && (v.il ?? v.io ?? 0) > 0
          ? 'The inductor is still carrying current, so the diodes cannot simply switch off — the current either commutates to the other diodes (full-wave) or keeps flowing until it decays to zero (half-wave).'
          : topo === 'half-wave'
            ? e.kind === 'vin-zero-rising'
              ? 'The anode becomes positive with respect to the source return; conduction starts as soon as the forward drop (and any capacitor voltage) is overcome.'
              : 'The source now drives in reverse; D1 blocks (unless stored energy keeps it on).'
            : 'The other half of the full-wave rectifier now has the positive side, so the next conduction pulse will come through the other diode(s).',
      }
    case 'phase-crossing':
      return { title, what: `Two phase voltages are equal ${at}.`, why: 'A natural commutation point: the highest or lowest phase changes here.' }
    case 'current-transfer':
      return {
        title,
        what: `${e.device} takes over the load current ${at}: io = ${formatA(v.io ?? 0)} flows on without a break.`,
        why: 'The inductor current cannot change instantly, so when one path closes the current simply moves to the other one.',
      }
    case 'energy-min':
      return { title, what: `The energy stored in L reaches a minimum, ½·L·i² = ${formatSI(v.wl ?? 0, 'J')}, ${at}.`, why: 'Here the inductor stops giving energy back and starts storing it again — the load current is at its lowest.' }
    case 'commutation-start':
    case 'commutation-end':
      return { title, what: `${title} ${at}.`, why: 'Commutation overlap: source inductance makes the current transfer between devices take time.' }
    case 'vout-max':
      return {
        title,
        what: `The output reaches a local maximum, Vout = ${formatV(v.vout ?? 0)}, ${at}.`,
        why: hasC ? 'The charging pulse ends near here; from now the capacitor discharges into R and the output droops.' : 'The output stops rising as the source passes its peak.',
      }
    case 'vout-min':
      return {
        title,
        what: `The output reaches a local minimum, Vout = ${formatV(v.vout ?? 0)}, ${at}.`,
        why: hasC
          ? 'The capacitor has discharged the most here — the bottom of the ripple. The next charging pulse begins.'
          : hasL && topo === 'half-wave'
            ? 'The output went negative while the inductor held D1 on; at extinction it snaps back to 0 V.'
            : 'The bottom of the output ripple.',
      }
  }
}
