import { sampleAt } from '../simulation/engine.ts'
import { sineSource } from '../simulation/source.ts'
import { halfWaveRTheory } from '../measurements/theory/halfWaveR.ts'
import type { CircuitEvent, DiodeBias, SimulationResult, SimulationSample } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import { trendAt, type Trend } from './trend.ts'

/** Stages of the causal chain, in the order the physics happens. */
export type CausalStage = 'source' | 'condition' | 'diode' | 'path' | 'energy' | 'output' | 'waveform'

export interface CausalStep {
  stage: CausalStage
  title: string
  text: string
}

export interface StateExplanation {
  sample: SimulationSample
  /** Source electrical angle θ = ωt + φ, in [0°, 360°). */
  angleDeg: number
  /** 1-based source cycle the instant belongs to. */
  cycle: number
  source: { polarity: 'positive' | 'negative' | 'zero'; trend: Trend; text: string }
  diode: { on: boolean; bias: DiodeBias; text: string }
  current: { flowing: boolean; trend: 'increasing' | 'decreasing' | 'at peak' | 'zero'; text: string }
  output: { conducting: boolean; text: string }
  /** Conduction path element names, or null when no current flows. */
  path: string[] | null
  headline: string
  /** One-paragraph answer to "why is this happening?" */
  summary: string
  chain: CausalStep[]
}

const CURRENT_PATH = ['Source (+)', 'D1', 'R', 'Source (−)']

/**
 * Explain the circuit state at one sample. Everything here is read from the
 * simulation result; the text is assembled from that state, never canned per time.
 */
export function explainHalfWaveR(result: SimulationResult, index: number): StateExplanation {
  const { params: p, trace } = result
  const s = sampleAt(result, index)
  const i = s.index
  const source = sineSource(p)
  const theory = halfWaveRTheory(p)
  const R = p.resistance
  const { vf, ron, kind } = p.diode
  const ideal = kind === 'ideal'
  const angleDeg = source.angleDeg(s.time)
  const cycle = Math.min(p.cycles, Math.floor(s.time / p.period) + 1)

  // --- Trends (from neighbouring samples) ------------------------------------------
  const vinTrend = trendAt(trace.time, trace.signals.vin, i, p.omega * p.vm)
  const ioPeakTheory = theory.ioPeak.value
  const ioTrendRaw = trendAt(trace.time, trace.signals.io, i, p.omega * Math.max(ioPeakTheory, 1e-300))
  const flowing = s.io > 0
  const currentTrend: StateExplanation['current']['trend'] = !flowing
    ? 'zero'
    : ioTrendRaw === 'rising'
      ? 'increasing'
      : ioTrendRaw === 'falling'
        ? 'decreasing'
        : 'at peak'

  const polarity = s.vin > 0 ? 'positive' : s.vin < 0 ? 'negative' : 'zero'
  const V = (v: number) => formatV(v)
  const vfText = ideal ? '0 V (ideal diode)' : formatSI(vf, 'V')
  const theta = formatDeg(angleDeg)
  const theta1Deg = (theory.theta1 * 180) / Math.PI
  const theta2Deg = (theory.theta2 * 180) / Math.PI

  // --- SOURCE -------------------------------------------------------------------------
  const trendWords: Record<Trend, string> = {
    rising: 'and rising',
    falling: 'and falling',
    peak: '— at its positive peak',
    trough: '— at its negative peak',
    flat: '',
  }
  const sourceText =
    polarity === 'zero'
      ? `Vin = 0 V (θ = ${theta}) — the source is crossing zero.`
      : `Vin = ${V(s.vin)} ${trendWords[vinTrend]} (θ = ${theta}, ${polarity} half-cycle).`.replace('  ', ' ')

  // --- CIRCUIT CONDITION: the assumed-state test the solver performed -----------------
  const iIfOn = (s.vin - vf) / (R + ron)
  let conditionText: string
  switch (s.bias) {
    case 'forward-conducting':
      conditionText =
        `Test "D1 OFF": with no current there is no drop across R, so the whole Vin = ${V(s.vin)} would sit across the diode, anode positive. ` +
        `That exceeds its threshold Vf = ${vfText}, which a blocking diode cannot hold — so OFF is impossible and D1 must be ON.`
      break
    case 'forward-below-threshold':
      conditionText =
        `Vin = ${V(s.vin)} makes the anode positive, but by less than Vf = ${vfText}. ` +
        `Test "D1 ON": KVL would need i = (Vin − Vf)/${ron > 0 ? '(R + Ron)' : 'R'} = ${formatA(iIfOn, true)} — current flowing backwards through the diode, which is impossible. So D1 stays OFF.`
      break
    case 'reverse':
      conditionText =
        `Vin = ${V(s.vin)} makes the anode negative with respect to the cathode. ` +
        `Test "D1 ON": KVL would need i = (Vin − Vf)/${ron > 0 ? '(R + Ron)' : 'R'} = ${formatA(iIfOn, true)}, i.e. current entering the cathode — impossible. So D1 is OFF: reverse biased.`
      break
    default:
      conditionText = 'Vin = 0: there is no voltage driving the loop, so no current can flow. D1 sits exactly on the boundary between OFF and ON.'
  }

  // --- DIODE ---------------------------------------------------------------------------
  let diodeText: string
  if (s.diodeState === 'ON') {
    diodeText = ideal
      ? 'D1 conducts like a closed switch: vD = 0 V.'
      : `D1 conducts. A real silicon diode holds a nearly constant drop while conducting: vD = Vf${ron > 0 ? ' + Ron·Id' : ''} = ${V(s.vd)}.`
  } else if (s.bias === 'reverse') {
    diodeText = `D1 is reverse biased and blocks, like an open switch. The entire source voltage appears across it: vD = Vin = ${V(s.vd)}.`
  } else if (s.bias === 'forward-below-threshold') {
    diodeText = `D1 is forward biased but below its knee voltage, so it stays OFF. With no current, nothing drops across R: vD = Vin = ${V(s.vd)}.`
  } else {
    diodeText = 'D1 is OFF with zero voltage across it.'
  }

  // --- PATH ----------------------------------------------------------------------------
  const pathText = flowing
    ? `Conventional current leaves the source's + terminal, enters D1 at the anode, exits the cathode, flows down through R and returns to the source's − terminal. ` +
      `It is a single series loop, so the same current flows everywhere: Io = Id = ${formatA(s.io)}.`
    : 'The loop is broken at D1. No current flows anywhere: Io = Id = 0 A.'

  // --- ENERGY --------------------------------------------------------------------------
  const pSource = s.vin * s.io
  const pLoad = s.vout * s.io
  const pDiode = s.vd * s.id
  const energyText = flowing
    ? `The source delivers ${formatW(pSource)}; R turns ${formatW(pLoad)} into heat` +
      (ideal ? '' : ` and D1 dissipates ${formatW(pDiode)}`) +
      '. A resistor stores no energy — power in equals power out at every instant — so nothing can keep current flowing once the source stops pushing.'
    : 'With no current, no power flows: the source delivers 0 W and R dissipates 0 W. Nothing in this circuit stores energy (no inductor or capacitor), so nothing can supply the load meanwhile.'

  // --- OUTPUT --------------------------------------------------------------------------
  const outputText = flowing
    ? `Vout = Io·R = ${formatA(s.io)} × ${formatSI(R, 'Ω')} = ${V(s.vout)}${ideal ? ' = Vin' : ` = Vin − vD`}.`
    : `Vout = Io·R = 0 A × ${formatSI(R, 'Ω')} = 0 V.`

  // --- WAVEFORM ------------------------------------------------------------------------
  let waveformText: string
  if (flowing) {
    const shift = ideal ? 'exactly on top of Vin' : `${formatSI(s.vd, 'V')} below Vin`
    if (currentTrend === 'at peak') {
      waveformText = `Vout and Io peak together with Vin: a resistor responds instantly, so there is no lag. Peak output = ${V(theory.voutPeak.value)}.`
    } else if (currentTrend === 'increasing') {
      waveformText = `That is why the Vout trace sits ${shift} and climbs with it, and Io has the same shape as Vout (Io = Vout/R).`
    } else {
      waveformText =
        `Vin is falling, so Vout and Io fall with it, ${shift}. ` +
        (ideal
          ? 'When Vin reaches 0 V (θ = 180°) the current reaches zero and D1 turns off.'
          : `When Vin drops to Vf (θ₂ = ${formatDeg(theta2Deg)}) the current reaches zero and D1 turns off — slightly before Vin crosses zero.`)
    }
  } else if (s.bias === 'reverse') {
    waveformText =
      `That is why Vout is flat at zero while the Vd trace follows the negative half of Vin. ` +
      `Its deepest point, vD = −Vm = ${V(-p.vm)}, is the peak inverse voltage the diode must be rated for.`
  } else if (s.bias === 'forward-below-threshold') {
    waveformText =
      vinTrend === 'falling'
        ? `Vin fell below Vf at θ₂ = ${formatDeg(theta2Deg)}, so current stopped before Vin reached zero. This "dead zone" at each end is why γ = ${formatDeg(theory.conductionAngleDeg.value)} instead of 180°.`
        : theory.conducts
          ? `Vout is still zero: the output only starts once Vin climbs past Vf at θ₁ = ${formatDeg(theta1Deg)}. This dead zone is why γ = ${formatDeg(theory.conductionAngleDeg.value)} instead of 180°.`
          : `Vm = ${V(p.vm)} never exceeds Vf, so the diode never conducts and Vout stays at zero for the whole cycle.`
  } else {
    waveformText = 'Vout and Io are zero at this instant.'
  }

  // --- Headline & summary --------------------------------------------------------------
  let headline: string
  let summary: string
  if (s.diodeState === 'ON') {
    headline = 'D1 is ON — current flows through R'
    summary = `Vin is positive and high enough (${V(s.vin)} > Vf = ${vfText}) to forward bias the diode. The diode conducts, so current flows through the resistor and Vout = ${V(s.vout)}.`
  } else if (s.bias === 'reverse') {
    headline = 'D1 is OFF — reverse biased, blocking'
    summary = `Vin is negative (${V(s.vin)}), so the diode is reverse biased. It blocks current, therefore Io = 0 and the output voltage is 0 V; the diode itself holds the full ${V(s.vd)}.`
  } else if (s.bias === 'forward-below-threshold') {
    headline = 'D1 is OFF — Vin is below Vf'
    summary = `Vin is positive (${V(s.vin)}) but below the diode's forward voltage Vf = ${vfText}, so the diode cannot conduct yet. Io = 0, Vout = 0 V.`
  } else {
    headline = 'Vin = 0 — no current'
    summary = 'The source voltage is zero, so nothing drives current around the loop. Io = 0 and Vout = 0 V.'
  }

  return {
    sample: s,
    angleDeg,
    cycle,
    source: { polarity, trend: vinTrend, text: sourceText },
    diode: { on: s.diodeState === 'ON', bias: s.bias, text: diodeText },
    current: { flowing, trend: currentTrend, text: pathText },
    output: { conducting: flowing, text: outputText },
    path: flowing ? CURRENT_PATH : null,
    headline,
    summary,
    chain: [
      { stage: 'source', title: 'Source', text: sourceText },
      { stage: 'condition', title: 'Circuit condition', text: conditionText },
      { stage: 'diode', title: 'Diode state', text: diodeText },
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
  'diode-on': 'D1 turns ON',
  'diode-off': 'D1 turns OFF',
  'current-start': 'Current starts',
  'current-stop': 'Current stops',
}

export function eventTitle(e: CircuitEvent): string {
  return EVENT_TITLES[e.kind]
}

/** Explain a detected event using the exact circuit solution at the event instant. */
export function explainEventHalfWaveR(result: SimulationResult, e: CircuitEvent): EventExplanation {
  const p = result.params
  const theory = halfWaveRTheory(p)
  const ideal = p.diode.kind === 'ideal'
  const vf = p.diode.vf
  const theta = formatDeg(sineSource(p).angleDeg(e.time))
  const at = `at t = ${formatTime(e.time)} (θ = ${theta})`
  const v = e.values
  const title = EVENT_TITLES[e.kind]
  const gamma = formatDeg(theory.conductionAngleDeg.value)

  switch (e.kind) {
    case 'diode-on':
      return {
        title,
        what: `D1 switches from blocking to conducting ${at}. Vin = ${formatV(v.vin)}.`,
        why: ideal
          ? 'An ideal diode conducts for any positive anode-to-cathode voltage. The moment Vin turns positive, staying OFF would leave a positive voltage across a blocking diode — impossible — so it turns ON.'
          : `Vin has just risen to Vf = ${formatSI(vf, 'V')}. Below that, a positive Vin was not enough to overcome the junction; above it, staying OFF would leave more than Vf across the diode — impossible — so it turns ON at θ₁ = asin(Vf/Vm).`,
      }
    case 'current-start':
      return {
        title,
        what: `Load current begins to flow ${at}, rising from 0 A.`,
        why: `Current can only flow once D1 conducts, so it starts at the same instant. It starts from zero, without a jump: the loop current is (Vin − ${ideal ? '0' : 'Vf'})/R, which is zero right at turn-on. A resistor has no energy storage, so nothing delays or speeds it up — it simply follows Vin.`,
      }
    case 'diode-off':
      return {
        title,
        what: `D1 stops conducting ${at}. Vin = ${formatV(v.vin)}.`,
        why: ideal
          ? 'In an R-only loop the current is Vin/R, so it reaches zero exactly when Vin does. To stay ON past this point the diode would have to carry negative current, which it cannot — so it turns OFF.'
          : `Vin has fallen to Vf = ${formatSI(vf, 'V')}, so the loop current (Vin − Vf)/R reaches zero. Staying ON would need negative diode current, so D1 turns OFF at θ₂ = 180° − θ₁ — slightly before Vin itself reaches zero. Conduction lasted γ = ${gamma}.`,
      }
    case 'current-stop':
      return {
        title,
        what: `Load current falls to 0 A ${at} and stays there until the next positive half-cycle.`,
        why: 'Nothing in this circuit stores energy, so there is nothing to keep current flowing once the source stops driving it forward. (With an inductor in the load — the RL rectifier — stored magnetic energy keeps current flowing past this point, and the diode stays on longer.)',
      }
    case 'vin-positive-peak':
      return {
        title,
        what: `Vin reaches its maximum Vm = ${formatV(v.vin)} ${at}. Vout = ${formatV(v.vout)}, Io = ${formatA(v.io)}.`,
        why: theory.conducts
          ? `Vm = √2·Vrms is the crest of the sine. Because the load is a pure resistor, Vout and Io respond instantly and peak at the same moment: Vo,pk = ${ideal ? 'Vm' : 'Vm − Vf'}, Io,pk = Vo,pk/R.`
          : 'Vm = √2·Vrms is the crest of the sine — but it is still not above Vf, so even at the peak the diode cannot conduct.',
      }
    case 'vin-negative-peak':
      return {
        title,
        what: `Vin reaches its most negative value −Vm = ${formatV(v.vin)} ${at}. The diode holds vD = ${formatV(v.vd)}.`,
        why: 'D1 is reverse biased and blocking, so no current flows and nothing drops across R: the full source voltage appears across the diode. This is the peak inverse voltage (PIV = Vm) — the diode must be rated above it.',
      }
    case 'vin-zero-rising':
      return {
        title,
        what: `Vin changes from negative to positive ${at}.`,
        why: ideal
          ? 'The anode becomes positive with respect to the cathode, so the ideal diode becomes forward biased and starts conducting right here.'
          : theory.conducts
            ? `The anode becomes positive, but the diode needs Vin > Vf = ${formatSI(vf, 'V')} before it can conduct — it will turn on a little later, at θ₁ = ${formatDeg((theory.theta1 * 180) / Math.PI)}.`
            : `The anode becomes positive, but Vm never exceeds Vf = ${formatSI(vf, 'V')}, so the diode will not conduct.`,
      }
    case 'vin-zero-falling':
      return {
        title,
        what: `Vin changes from positive to negative ${at}.`,
        why: ideal
          ? 'The diode current Vin/R reaches zero here and the diode becomes reverse biased. From now until the next positive half-cycle it blocks, and the source voltage appears across D1 instead of R.'
          : 'The diode already turned off slightly earlier, when Vin fell below Vf. From here on it is reverse biased: the source voltage appears across D1 instead of R.',
      }
  }
}
