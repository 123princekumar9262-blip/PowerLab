import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import { nextRunEvent } from '../cursor.ts'
import { converterIndexAt, converterSample, segmentAverage } from '../engine.ts'
import type { BuckInterval, ConverterEvent, ConverterKind, ConverterResult } from '../types.ts'
import { dcdcBoundary } from './theory.ts'

/**
 * DC-DC explanations generated from the simulation state (no language model): every number in a
 * sentence is read from the trace at the cursor, and the sentence chosen depends on that state and
 * on the converter (buck, boost, buck-boost).
 */

export type DcdcPart = 'vin' | 'q1' | 'd1' | 'l' | 'c' | 'r' | 'sw' | 'out' | 'gnd'

export interface DcdcState {
  kind: ConverterKind
  k: number
  t: number
  /** Position inside the switching period, 0 … 1. */
  phase: number
  interval: BuckInterval
  gate: boolean
  qOn: boolean
  dOn: boolean
  il: number
  vl: number
  vc: number
  vout: number
  ic: number
  io: number
  iq: number
  id: number
  vsw: number
  vq: number
  vd: number
  el: number
  ec: number
  pin: number
  pout: number
  /** Instantaneous slopes from the circuit equations at this sample: diL/dt = vL/L, dvC/dt = iC/C. */
  dildt: number
  dvcdt: number
  /** Power into L (vL·iL, + = storing), into C (vC·iC, + = charging). */
  pL: number
  pC: number
  /** Parts carrying current (for the diagram), and the loop in words. */
  path: DcdcPart[]
  pathText: string
}

export function dcdcStateAt(r: ConverterResult, k: number): DcdcState {
  const s = converterSample(r, k)
  const p = r.params
  const kind = p.kind ?? 'buck'
  const interval: BuckInterval = s.qOn ? 'on' : s.dOn ? 'off' : 'idle'
  const ph = s.t / p.ts - Math.floor(s.t / p.ts + 1e-9)
  // Capacitor charging means |vC| growing (vC is negative for the buck-boost).
  const charging = s.vc * s.ic >= 0
  const cap = charging ? 'C charges' : 'C discharges'
  let path: DcdcPart[]
  let pathText: string
  if (interval === 'idle') {
    path = ['c', 'r', 'out', 'gnd']
    pathText = 'C → R → ground: the capacitor alone feeds the load (no current in L, Q1 or D1)'
  } else if (kind === 'buck') {
    path = interval === 'on' ? ['vin', 'q1', 'sw', 'l', 'out', 'c', 'r', 'gnd'] : ['d1', 'sw', 'l', 'out', 'c', 'r', 'gnd']
    pathText = interval === 'on' ? `Vin+ → Q1 → L → output → R (and ${cap}) → ground → Vin−` : `L → output → R (${cap}) → ground → D1 → back to L`
  } else if (kind === 'boost') {
    path = interval === 'on' ? ['vin', 'l', 'sw', 'q1', 'gnd', 'c', 'r', 'out'] : ['vin', 'l', 'sw', 'd1', 'out', 'c', 'r', 'gnd']
    pathText = interval === 'on' ? 'Vin+ → L → Q1 → ground → Vin−; meanwhile C alone feeds R' : `Vin+ → L → D1 → output → R (${cap}) → ground → Vin−: source AND inductor feed the load`
  } else {
    path = interval === 'on' ? ['vin', 'q1', 'sw', 'l', 'gnd', 'c', 'r', 'out'] : ['l', 'gnd', 'r', 'c', 'out', 'd1', 'sw']
    pathText = interval === 'on' ? 'Vin+ → Q1 → L → ground → Vin−; meanwhile C alone feeds R' : `L → ground → R (${cap}) → output → D1 → back to L: current is pulled OUT of the output, so Vout is negative`
  }
  return {
    kind,
    k: s.k,
    t: s.t,
    phase: ph,
    interval,
    gate: s.gate > 0.5,
    qOn: s.qOn,
    dOn: s.dOn,
    il: s.il,
    vl: s.vl,
    vc: s.vc,
    vout: s.vout,
    ic: s.ic,
    io: s.io,
    iq: s.iq,
    id: s.id,
    vsw: s.vsw,
    vq: s.vq,
    vd: s.vd,
    el: s.el,
    ec: s.ec,
    pin: s.pin,
    pout: s.pout,
    dildt: s.vl / p.l,
    dvcdt: s.ic / p.c,
    pL: s.vl * s.il,
    pC: s.vc * s.ic,
    path,
    pathText,
  }
}

/** A slope in A/µs or V/ms, the units students read off a scope. */
export const formatSlopeA = (x: number) => `${x >= 0 ? '+' : '−'}${formatSI(Math.abs(x) * 1e-6, 'A/µs')}`
export const formatSlopeV = (x: number) => `${x >= 0 ? '+' : '−'}${formatSI(Math.abs(x) * 1e-3, 'V/ms')}`

export const INTERVAL_NAME: Record<BuckInterval, string> = {
  on: 'Switch ON interval',
  off: 'Freewheeling interval (switch OFF, diode ON)',
  idle: 'Idle interval (DCM: both OFF, iL = 0)',
}

export interface WhyCard {
  id: string
  question: string
  what: string
  why: string
  equation: string
  physics: string
  whatIf: string
}

function lastEvent(r: ConverterResult, kind: ConverterEvent['kind'], t: number): ConverterEvent | undefined {
  let found: ConverterEvent | undefined
  for (const e of r.events) {
    if (e.time > t + r.params.dt * 1e-6) break
    if (e.kind === kind) found = e
  }
  return found
}

/** The conversion law in words, per converter (THEORY, ideal CCM). */
export const CCM_LAW: Record<ConverterKind, string> = {
  buck: 'Vout = D·Vin',
  boost: 'Vout = Vin/(1 − D)',
  'buck-boost': 'Vout = −D·Vin/(1 − D)',
}

/**
 * The ESR part of the output ripple: the jump of the capacitor current times the ESR. In a buck the capacitor
 * current swings by ΔiL; in a boost or buck-boost it steps by the diode current (≈ iL,max) when the diode turns
 * on. An estimate from the simulated currents (the two parts do not simply add), 0 without ESR.
 */
export function esrRipple(kind: ConverterKind, esr: number, m: { ilPP: number; ilMax: number }): number {
  return esr * (kind === 'buck' ? m.ilPP : m.ilMax)
}

/**
 * What a change of C (or of fs) does to the output ripple, in words that hold for the simulated parameters:
 * without ESR the ripple is the capacitor's own (∝ 1/C); with ESR the step ESR·ΔiC does not depend on C at all.
 */
export function rippleNote(kind: ConverterKind, esr: number, m: { ilPP: number; ilMax: number; voutPP: number }): string {
  if (!(esr > 0)) return ''
  const part = esrRipple(kind, esr, m)
  const share = part / Math.max(m.voutPP, 1e-12)
  return ` With ESR = ${formatSI(esr, 'Ω')}, part of the ripple is the step ESR·ΔiC ≈ ${formatSI(part, 'V')} (of ${formatSI(m.voutPP, 'V')} peak-to-peak), which no capacitance changes${share > 0.5 ? ' — here it dominates, so a larger C reduces the ripple only a little' : ''}.`
}

/**
 * WHY cards for the state at the cursor: What → Why → Equation → Physics → What-if. `ripple` holds
 * the simulated ripples (from the measurements) used by the what-if lines.
 */
export function dcdcWhy(r: ConverterResult, st: DcdcState, ripple: { ilPP: number; voutPP: number; ilMax?: number }): WhyCard[] {
  const p = r.params
  const kind = st.kind
  const cards: WhyCard[] = []
  const vf = p.d.vf
  const offAt = lastEvent(r, 'gate-off', st.t)
  const onAt = lastEvent(r, 'gate-on', st.t)
  const zeroAt = lastEvent(r, 'il-zero', st.t)
  const b = dcdcBoundary(p)
  let vdMin = 0
  for (const x of r.signals.vd) vdMin = Math.min(vdMin, x)

  // 1. The diode.
  if (st.interval === 'on') {
    const where =
      kind === 'buck'
        ? `D1's anode is at ground (0 V) and its cathode is the switch node at ${formatV(st.vsw)}`
        : kind === 'boost'
          ? `Q1 holds the switch node (D1's anode) at ${formatV(st.vsw)}, while D1's cathode is the output at ${formatV(st.vout)}`
          : `D1's cathode is the switch node, pulled up to ${formatV(st.vsw)} by Q1, and its anode is the (negative) output at ${formatV(st.vout)}`
    cards.push({
      id: 'diode',
      question: 'Why is D1 OFF?',
      what: `D1 is OFF and Q1 conducts. The switch node sits at vsw = ${formatV(st.vsw)}.`,
      why: `${where}, so vD = ${formatV(st.vd)}: reverse biased. A diode conducts only when vD reaches Vf (${formatV(vf, false)}).`,
      equation: kind === 'buck' ? `vD = 0 − vsw = ${formatV(st.vd)} < Vf` : kind === 'boost' ? `vD = vsw − vout = ${formatV(st.vd)} < Vf` : `vD = vout − vsw = ${formatV(st.vd)} < Vf`,
      physics:
        kind === 'buck'
          ? `With Q1 closed, the switch node is tied to Vin (minus Q1's drop iL·Ron = ${formatV(st.iq * p.q.ron, false)}). D1 blocks the full input voltage.`
          : kind === 'boost'
            ? 'With the switch node held near ground, D1 keeps the output capacitor from discharging back through Q1. It blocks the whole output voltage.'
            : 'D1 blocks Vin + |Vout|: the largest voltage in the circuit.',
      whatIf: `Its reverse-voltage rating must exceed the largest reverse voltage it sees (here ${formatV(-vdMin, false)}).`,
    })
  } else if (st.interval === 'off') {
    const toward =
      kind === 'buck'
        ? 'the switch-node voltage falls until D1 becomes forward biased'
        : kind === 'boost'
          ? 'the switch-node voltage RISES until D1 becomes forward biased — above the output voltage'
          : 'the switch-node voltage falls below the output (negative) until D1 becomes forward biased'
    cards.push({
      id: 'diode',
      question: 'Why did D1 turn ON?',
      what: `Q1 turned OFF${offAt ? ` at t = ${formatTime(offAt.time)}` : ''}, but current keeps flowing: iL = ${formatA(st.il)}, now through D1.`,
      why: `An inductor current cannot change instantly: stopping it would need |vL| = L·|di/dt| → ∞. So ${toward} and takes over the current: vsw = ${formatV(st.vsw)}.`,
      equation:
        kind === 'buck'
          ? `vsw = −(Vf + iL·Ron,D) = ${formatV(st.vsw)},  iD = iL = ${formatA(st.id)}`
          : kind === 'boost'
            ? `vsw = vout + Vf + iL·Ron,D = ${formatV(st.vsw)},  iD = iL = ${formatA(st.id)}`
            : `vsw = vout − Vf − iL·Ron,D = ${formatV(st.vsw)},  iD = iL = ${formatA(st.id)}`,
      physics:
        kind === 'buck'
          ? 'The inductor acts as a current source: it forces the diode on. D1 gives the inductor current a closed path (L → load → ground → D1 → L).'
          : kind === 'boost'
            ? 'The inductor acts as a current source in series with Vin: their voltages ADD (vL < 0 now), which is how the output gets above the input.'
            : 'The inductor pushes its current down to ground; the only way back to it is out of the output node through D1. Charge is pulled out of the output: that is why Vout is negative.',
      whatIf: 'Without D1, the switch-node voltage would swing to a huge value at turn-off and destroy Q1: the diode is what lets the inductor current continue.',
    })
  } else {
    cards.push({
      id: 'diode',
      question: 'Why is D1 OFF while Q1 is OFF?',
      what: `Both devices are OFF. iL = 0, and the switch node rests at vsw = ${formatV(st.vsw)}${kind === 'buck' ? ' (= Vout)' : kind === 'boost' ? ' (= Vin)' : ' (= ground)'}.`,
      why: `The inductor current fell to zero${zeroAt ? ` at t = ${formatTime(zeroAt.time)}` : ''}. D1 cannot carry reverse current, so it turned OFF there instead of letting iL go negative.`,
      equation: `iL = 0  ⇒  vL = 0  ⇒  vsw = ${kind === 'buck' ? 'Vout' : kind === 'boost' ? 'Vin' : '0'}`,
      physics: 'This is discontinuous conduction mode (DCM): all energy stored in L has been delivered; until Q1 turns on again only the capacitor feeds the load.',
      whatIf: `A larger L (or a smaller load current) moves the converter back to CCM: CCM needs L > ${b.lCritFormula.replace('Lcrit = ', '')} = ${formatSI(b.lCrit, 'H')}.`,
    })
  }

  // 2. The inductor current.
  const rising = st.dildt > 0
  const vlExpr =
    st.interval === 'idle'
      ? 'vL = 0'
      : kind === 'buck'
        ? `vL = vsw − Vout = ${formatV(st.vsw)} − ${formatV(st.vout)} = ${formatV(st.vl)}`
        : kind === 'boost'
          ? `vL = Vin − vsw = ${formatV(p.vin, false)} − ${formatV(st.vsw)} = ${formatV(st.vl)}`
          : `vL = vsw − 0 = ${formatV(st.vl)}`
  cards.push({
    id: 'il',
    question: st.interval === 'idle' ? 'Why does iL stay at zero?' : `Why is iL ${rising ? 'rising' : 'falling'}?`,
    what: st.interval === 'idle' ? 'iL = 0 and stays there until the next gate pulse.' : `iL = ${formatA(st.il)} and is ${rising ? 'rising' : 'falling'} at ${formatSlopeA(st.dildt)}.`,
    why:
      st.interval === 'on'
        ? kind === 'buck'
          ? `Q1 connects the inductor between Vin and the output: ${vlExpr} > 0.`
          : `Q1 connects the inductor straight across the input: ${vlExpr} > 0.`
        : st.interval === 'off'
          ? kind === 'buck'
            ? `D1 connects the inductor between ground and the output: ${vlExpr} < 0 — the inductor releases energy.`
            : kind === 'boost'
              ? `D1 connects the inductor between Vin and the output, which is higher than Vin: ${vlExpr} < 0 — the inductor releases energy into the output.`
              : `D1 connects the inductor across the (negative) output: ${vlExpr} < 0 — the inductor releases energy into the output.`
          : 'No device conducts, so no voltage drives the inductor: vL = 0.',
    equation: st.interval === 'idle' ? 'diL/dt = vL/L = 0' : `diL/dt = vL/L = ${formatV(st.vl)} / ${formatSI(p.l, 'H')} = ${formatSlopeA(st.dildt)}`,
    physics:
      st.interval === 'on'
        ? `Energy flows from the source into the magnetic field: EL = ½·L·iL² = ${formatSI(st.el, 'J')} and growing.`
        : st.interval === 'off'
          ? `The magnetic field gives energy to the output: EL = ${formatSI(st.el, 'J')} and shrinking.`
          : 'EL = 0: the inductor has no stored energy.',
    whatIf: `Slope ∝ 1/L: with L doubled, iL would change at half this rate, so the ripple ΔiL (now ${formatA(ripple.ilPP)}) would roughly halve. With fs doubled the intervals halve — ΔiL halves as well.`,
  })

  // 3. The output voltage (for the buck-boost, its magnitude).
  const mag = kind === 'buck-boost'
  const growing = st.vc * st.ic > 0
  const feeds = kind === 'buck' ? 'iL' : kind === 'boost' ? (st.interval === 'off' ? 'iL' : '0') : st.interval === 'off' ? '−iL' : '0'
  cards.push({
    id: 'vout',
    question: Math.abs(st.dvcdt) < 1e-9 ? 'Why is Vout steady now?' : `Why is ${mag ? '|Vout|' : 'Vout'} ${growing ? 'rising' : 'falling'} now?`,
    what: `Vout = ${formatV(st.vout)}, changing at ${formatSlopeV(st.dvcdt)}. Current delivered to the output: ${feeds === '0' ? '0 A' : formatA(feeds === 'iL' ? st.il : -st.il, true)}; load current iR = ${formatA(st.io, true)}.`,
    why:
      feeds === '0'
        ? `While Q1 is ON nothing feeds the output in a ${kind}: the capacitor alone supplies the load, iC = ${formatA(st.ic, true)}, so ${mag ? '|Vout|' : 'Vout'} falls.`
        : growing
          ? `The converter delivers more current than the load takes: the difference iC = ${formatA(st.ic, true)} charges the capacitor.`
          : `The load takes more current than the converter delivers: the capacitor supplies the difference, iC = ${formatA(st.ic, true)}.`,
    equation: `C·dvC/dt = iC = ${feeds} − iR  ⇒  dvC/dt = ${formatA(st.ic, true)} / ${formatSI(p.c, 'F')} = ${formatSlopeV(st.dvcdt)}`,
    physics: 'The capacitor absorbs the AC part of the current delivered to the output, so the load sees an almost constant voltage. That small up-and-down is the output ripple.',
    whatIf:
      p.esr > 0
        ? `Doubling C would halve only the capacitor's own part of the output ripple (now ${formatSI(ripple.voutPP, 'V')} peak-to-peak).${rippleNote(kind, p.esr, { ilPP: ripple.ilPP, ilMax: ripple.ilMax ?? ripple.ilPP, voutPP: ripple.voutPP })}`
        : `Ripple ∝ 1/C (no ESR): doubling C would roughly halve the output ripple (now ${formatSI(ripple.voutPP, 'V')} peak-to-peak).`,
  })

  // 4. The gate.
  cards.push({
    id: 'gate',
    question: `Why is Q1 ${st.qOn ? 'ON' : 'OFF'}?`,
    what: `The PWM gate is ${st.gate ? 'HIGH' : 'LOW'} (${(st.phase * 100).toFixed(1)} % into the period).`,
    why: `The PWM keeps Q1 ON for the first D = ${(p.duty * 100).toFixed(0)} % of every period Ts = ${formatTime(p.ts)}, i.e. ton = ${formatTime(p.duty * p.ts)}.${onAt && st.qOn ? ` It last turned ON at t = ${formatTime(onAt.time)}.` : ''}`,
    equation: `ton = D·Ts = ${p.duty.toFixed(2)} × ${formatTime(p.ts)} = ${formatTime(p.duty * p.ts)}`,
    physics: 'Q1 is a controlled switch: unlike the diode, its state is set by the gate, not by the circuit voltages.',
    whatIf: `A larger D keeps Q1 on longer and stores more energy in L each period; ${kind === 'buck' ? 'Vout rises' : '|Vout| rises'} (ideal CCM: ${CCM_LAW[kind]}).`,
  })
  return cards
}

/** Volt-second balance from the simulated averages (event-aware). */
export function voltSecondFromSim(r: ConverterResult): { vswAvg: number; voutAvg: number; vlAvg: number } {
  return { vswAvg: segmentAverage(r, 'vsw'), voutAvg: segmentAverage(r, 'vout'), vlAvg: segmentAverage(r, 'vl') }
}

export function eventLabel(e: ConverterEvent): string {
  switch (e.kind) {
    case 'gate-on':
      return 'Q1 turns ON (gate rises)'
    case 'gate-off':
      return 'Q1 turns OFF (gate falls)'
    case 'diode-on':
      return 'D1 turns ON'
    case 'diode-off':
      return 'D1 turns OFF'
    case 'il-zero':
      return 'iL reaches zero (DCM)'
    default:
      return `${e.device ?? ''} ${e.kind}`
  }
}

/** One-sentence WHY for a switching event, from the event's own values. */
export function eventWhy(e: ConverterEvent): string {
  const v = e.values
  switch (e.kind) {
    case 'gate-on':
      return `The PWM period starts: Q1 closes and the switch node moves to ${formatV(v.vsw ?? 0)}. iL starts rising from ${formatA(v.il ?? 0)}.`
    case 'gate-off':
      return `D·Ts has elapsed: the gate falls and Q1 opens while iL = ${formatA(v.il ?? 0)}.`
    case 'diode-on':
      return `The inductor keeps its current (${formatA(v.il ?? 0)}); the switch node moves to ${formatV(v.vsw ?? 0)}, forward-biasing D1.`
    case 'diode-off':
      return (v.gate ?? 0) > 0.5
        ? `Q1 took over the inductor current; the switch node moved to ${formatV(v.vsw ?? 0)} and reverse-biased D1.`
        : 'The inductor current fell to zero; D1 cannot conduct backwards, so it turns OFF.'
    case 'il-zero':
      return 'All energy stored in L has been delivered. Until the next gate pulse, only C feeds the load (DCM).'
    default:
      return ''
  }
}

// ── Workspace shell: status line and "next consequence" (wording only, read from the run) ──────────

/** One line for the status bar: the switch, what the inductor is doing, the diode — from the simulated devices. */
export function dcdcStatus(st: DcdcState): { headline: string; facts: string[]; tone: 'on' | 'off' | 'idle' } {
  if (st.interval === 'on')
    return { headline: 'Switch ON', facts: [st.dildt >= 0 ? 'inductor charging (iL rising)' : 'iL falling', st.dOn ? 'diode ON' : 'diode OFF'], tone: 'on' }
  // OFF: the buck's diode freewheels the load current; the boost's and buck-boost's diode delivers the inductor's energy to the output
  if (st.interval === 'off') return { headline: 'Switch OFF', facts: [st.kind === 'buck' ? 'diode freewheeling' : 'diode feeds the output', st.dildt <= 0 ? 'inductor discharging (iL falling)' : 'iL rising'], tone: 'off' }
  return { headline: 'Switch OFF', facts: ['diode OFF', 'iL = 0 (idle, discontinuous conduction)'], tone: 'idle' }
}

/**
 * NEXT CONSEQUENCE: where the present interval ends, quoting the run's own next event (gate edge, diode
 * turn-off, iL reaching zero). Null when the shown run has no such event ahead — nothing is invented.
 */
export function dcdcNextConsequence(r: ConverterResult, st: DcdcState): { text: string; time: number } | null {
  // the next event whose new state the cursor does not show yet (an edge on the cursor's sample is still ahead)
  const k = converterIndexAt(r, st.t)
  const next = (kinds: string[]) => nextRunEvent(r, k, kinds) ?? undefined
  const at = (t: number) => `t = ${formatTime(t)}`
  const say = (text: string, e: { time: number }) => ({ text, time: e.time })
  if (st.interval === 'on') {
    const e = next(['gate-off'])
    if (!e) return null
    return say(`iL keeps ${st.dildt >= 0 ? 'rising' : 'falling'} at ${formatSlopeA(st.dildt)} (vL = ${formatV(st.vl)}) until the gate goes LOW at ${at(e.time)} — then Q1 turns OFF and the inductor forces its current through D1.`, e)
  }
  if (st.interval === 'off') {
    const e = next(['gate-on', 'il-zero', 'diode-off'])
    if (!e) return null
    if (e.kind === 'gate-on') return say(`iL keeps falling at ${formatSlopeA(st.dildt)} through D1 until Q1 turns ON again at ${at(e.time)} — then the source drives iL up once more.`, e)
    return say(`iL falls to zero at ${at(e.time)}: D1 turns OFF and nothing conducts until the next gate pulse (discontinuous conduction).`, e)
  }
  const e = next(['gate-on'])
  if (!e) return null
  return say(`Nothing conducts until Q1 turns ON at ${at(e.time)}; then iL starts rising from zero.`, e)
}

/** The next consequence in words (see dcdcNextConsequence for the event time it quotes). */
export function dcdcNext(r: ConverterResult, st: DcdcState): string | null {
  return dcdcNextConsequence(r, st)?.text ?? null
}

/**
 * ENERGY at the cursor, from the simulated sample: every element's instantaneous power (+ absorbing,
 * − supplying) — source, switch (vQ·iQ), diode (vD·iD), winding resistance (rL·iL²), ESR (esr·iC²),
 * inductor (vL·iL), capacitor (vC·iC), load (vout²/R) — and the stored energies. Σp ≈ 0 is a check on
 * the simulation (energy conservation), not an assumption: no element is computed as a remainder.
 */
export function dcdcEnergy(st: DcdcState, m: { elMax: number; voutMax: number; voutMin: number }, p: { c: number; rl: number; esr: number }) {
  const ledger = [
    { id: 'src', label: 'Source Vin', watts: -st.pin, note: 'supplies energy while Q1 (buck) draws from it' },
    { id: 'q', label: 'Switch Q1', watts: st.vq * st.iq, note: 'conduction loss vQ·iQ' },
    { id: 'd', label: 'Diode D1', watts: st.vd * st.id, note: 'conduction loss vD·iD while freewheeling' },
    { id: 'l', label: 'Inductor L', watts: st.pL, note: 'stores ½·L·iL² (vL·iL: + storing, − releasing)' },
    { id: 'c', label: 'Capacitor C', watts: st.pC, note: 'stores ½·C·vC² (vC·iC: + charging, − discharging)' },
    { id: 'rl', label: 'Winding + ESR', watts: p.rl * st.il * st.il + p.esr * st.ic * st.ic, note: 'rL·iL² + ESR·iC² as heat' },
    { id: 'r', label: 'Load R', watts: st.pout, note: 'turns energy into heat (always absorbing)' },
  ]
  const ecMax = 0.5 * p.c * Math.max(m.voutMax ** 2, m.voutMin ** 2)
  return {
    ledger,
    stores: [
      { id: 'l', label: 'Inductor EL = ½·L·iL²', joules: st.el, fraction: st.el / Math.max(m.elMax, 1e-15), detail: `${st.pL >= 0 ? 'storing' : 'releasing'} ${formatW(Math.abs(st.pL))}` },
      { id: 'c', label: 'Capacitor EC = ½·C·vC²', joules: st.ec, fraction: st.ec / Math.max(ecMax, 1e-15), detail: `${st.pC >= 0 ? 'charging' : 'discharging'} ${formatW(Math.abs(st.pC))}` },
    ],
    balance: ledger.reduce((a, r) => a + r.watts, 0),
    tolerance: 1e-6 * Math.max(1e-12, ...ledger.map((r) => Math.abs(r.watts))) + 1e-9,
  }
}
