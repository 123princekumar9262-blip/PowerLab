import type { AnalysisCategory, CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, StatusInfo, TextbookValue, WhyCard } from '../../lab/types.ts'
import type { CurrentPath, EnergyModel, NextConsequence } from '../../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { splitUnit } from './diodeContent.ts'
import { exactScr, gateDelay, measureScr, rlTimeTo, scrDerived, SCR_DEFAULTS, textbookScr, type AuxState, type ScrMeasurements, type ScrParams, type ScrRun, type ScrState } from './scr.ts'

export { measureScr }

export type ScrPhase = 'blocking' | 'gate charging' | 'ON, held by the gate' | 'latched' | 'commutating' | 'turned off'

export interface ScrView {
  k: number
  t: number
  ig: number
  ia: number
  il: number
  ifw: number
  ic: number
  vak: number
  vk: number
  vc: number
  /** Stored charge over the critical charge Qc. */
  qn: number
  s: ScrState
  a: AuxState
  r: number
  phase: ScrPhase
}

const measured = new WeakMap<ScrRun, ScrMeasurements>()
export function scrMeasured(r: ScrRun): ScrMeasurements {
  let m = measured.get(r)
  if (!m) {
    m = measureScr(r)
    measured.set(r, m)
  }
  return m
}

/** First conduction instant of the run (null if it never fires). */
const firstOn = (r: ScrRun) => {
  const td = scrMeasured(r).td
  return td === null ? null : r.params.tg0 + td
}

export function scrStateAt(r: ScrRun, k: number): ScrView {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const t = r.time[i]
  const d = scrDerived(p, [s.il[i], s.vc[i], s.q[i] * p.qc], r.modes[i], t - 1e-9 * p.dt)
  const on0 = firstOn(r)
  let phase: ScrPhase
  if (d.s === 'on') phase = 'ON, held by the gate'
  else if (d.s === 'lat') phase = 'latched'
  else if (d.s === 'rec') phase = 'commutating'
  else if (d.ig > 0) phase = 'gate charging'
  else phase = on0 !== null && t > on0 ? 'turned off' : 'blocking'
  const rr = p.test === 'hold' && t > p.t2 ? p.r2 : p.r
  return { k: i, t, ig: d.ig, ia: d.ia, il: d.iL, ifw: d.ifw, ic: d.ic, vak: d.vak, vk: d.vk, vc: d.vC, qn: s.q[i], s: d.s, a: d.a, r: rr, phase }
}

const STATE_TEXT: Record<ScrState, string> = { off: 'OFF (blocking)', on: 'ON — only while the gate is on', lat: 'ON — latched', rec: 'OFF — but charge left (can refire)' }

export function scrView(st: ScrView): StateView {
  return {
    badge: { text: st.phase, tone: st.phase === 'latched' || st.phase === 'ON, held by the gate' ? 'on' : st.phase === 'commutating' || st.phase === 'gate charging' ? 'idle' : 'off' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'SCR', v: STATE_TEXT[st.s], full: true, tone: st.s === 'on' || st.s === 'lat' ? 'on-q' : 'off' },
      { k: 'anode current iA', v: formatA(st.ia) },
      { k: 'SCR voltage vAK', v: formatV(st.vak) },
      { k: 'gate current', v: formatA(st.ig) },
      { k: 'stored charge q/Qc', v: st.qn.toFixed(3), tone: st.qn >= 1 ? 'on-q' : 'off' },
      { k: 'load current', v: formatA(st.il), min: 'standard' },
      { k: 'freewheeling diode', v: st.ifw > 1e-9 ? `ON · ${formatA(st.ifw)}` : 'OFF', tone: st.ifw > 1e-9 ? 'on-d' : 'off', min: 'standard' },
      { k: 'commutation capacitor', v: `${formatV(st.vc)}${st.ic > 0 ? ` · charging at ${formatA(st.ic)}` : ''}`, min: 'standard' },
      { k: 'load voltage', v: formatV(st.vk), min: 'engineer' },
    ],
    path: scrPathText(st),
  }
}

function scrPathText(st: ScrView): string {
  if (st.s === 'on' || st.s === 'lat') return `V → SCR (${formatA(st.ia)}) → R → L → back to V`
  if (st.ic > 0) return `V → capacitor C (${formatA(st.ic)}, through TA) → R → L: the SCR is bypassed`
  if (st.ifw > 1e-9) return `L → Dfw → R → L: the load current freewheels (${formatA(st.ifw)}); the SCR blocks ${formatV(st.vak, false)}`
  return `No current: the SCR blocks ${formatV(st.vak, false)}`
}

export function scrStatus(st: ScrView): StatusInfo {
  const q = `q/Qc = ${st.qn.toFixed(2)}`
  switch (st.phase) {
    case 'blocking':
      return { headline: 'SCR OFF · blocking', facts: [`vAK = ${formatV(st.vak, false)}`, q], tone: 'off' }
    case 'gate charging':
      return { headline: 'Gate pulse · charging the SCR', facts: [`iG = ${formatA(st.ig)}`, q, 'no anode current yet'], tone: 'idle' }
    case 'ON, held by the gate':
      return { headline: 'SCR ON · held by the gate (not latched)', facts: [`iA = ${formatA(st.ia)} rising`, `gate ${formatA(st.ig)}`], tone: 'on' }
    case 'latched':
      return { headline: 'SCR ON · latched', facts: [`iA = ${formatA(st.ia)}`, `vAK = ${formatV(st.vak, false)}`, st.ig > 0 ? 'gate still on' : 'no gate needed'], tone: 'on' }
    case 'commutating':
      return { headline: 'Forced commutation · SCR current is zero', facts: [`vAK = ${formatV(st.vak)}`, q, st.vak < 0 ? 'reverse biased' : 'forward voltage back'], tone: 'idle' }
    default:
      return { headline: 'SCR OFF · turned off', facts: [`vAK = ${formatV(st.vak)}`, q, st.ifw > 1e-9 ? `Dfw carries ${formatA(st.ifw)}` : st.ic > 0 ? `C charging (${formatA(st.ic)})` : 'no load current'], tone: 'off' }
  }
}

export function scrNext(r: ScrRun, st: ScrView, m: ScrMeasurements): NextConsequence | null {
  const p = r.params
  const t = st.t
  const ahead = (x: number | null) => x !== null && x > t + 0.5 * p.dt
  const tOn = m.td !== null ? p.tg0 + m.td : null
  const tLat = m.tLatch !== null ? p.tg0 + m.tLatch : null
  const tGe = p.tg0 + p.tw
  if (st.phase === 'blocking' && t < p.tg0) return { text: `The gate pulse starts at t = ${formatTime(p.tg0)} (${formatA(p.ig)} for ${formatTime(p.tw)}).`, time: p.tg0 }
  if (st.phase === 'gate charging') {
    if (ahead(tOn)) return { text: `The stored charge reaches Qc at t = ${formatTime(tOn!)}: the SCR fires and the anode current starts to rise.`, time: tOn }
    return { text: `The gate current ${formatA(p.ig)} is ${p.ig > p.igt ? 'above' : 'BELOW'} IGT = ${formatA(p.igt)}: ${p.ig > p.igt ? 'the charge keeps growing' : 'q settles below Qc — the SCR never fires'}. The pulse ends at t = ${formatTime(tGe)}.`, time: tGe }
  }
  if (st.phase === 'ON, held by the gate') {
    if (ahead(tLat)) return { text: `iA reaches IL = ${formatA(p.il)} at t = ${formatTime(tLat!)}, before the gate ends at ${formatTime(tGe)}: the SCR latches.`, time: tLat }
    return { text: `The gate ends at t = ${formatTime(tGe)} with iA ≈ ${formatA(m.iaGateEnd)} < IL = ${formatA(p.il)}: the SCR will turn off and the load current will freewheel through Dfw.`, time: tGe }
  }
  if (st.phase === 'latched') {
    if (p.test === 'commutate' && t < p.tcom) return { text: `The commutation thyristor TA fires at t = ${formatTime(p.tcom)}: the capacitor reverse-biases the SCR and takes its current (${formatA(m.iT)}).`, time: p.tcom }
    if (p.test === 'hold' && t < p.t2) return { text: `At t = ${formatTime(p.t2)} the load resistance steps to ${formatSI(p.r2, 'Ω')}: the current falls towards ${formatA(m.i2)}.`, time: p.t2 }
    if (p.test === 'hold' && m.tDrop !== null) return { text: `The stored charge falls below Qc at t = ${formatTime(p.t2 + m.tDrop)}: the SCR drops out (the current ${formatA(m.iDrop ?? NaN)} is below IH).`, time: p.t2 + m.tDrop }
    return { text: `Nothing turns it off in this run: a latched SCR stays on, gate or no gate, while its current stays above IH = ${formatA(p.ih)}.`, time: null }
  }
  if (st.phase === 'commutating') {
    const tFwd = m.tc !== null ? p.tcom + m.tc : null
    const tRec = m.tqRun !== null ? p.tcom + m.tqRun : null
    if (ahead(tRec) && (!ahead(tFwd) || tRec! < tFwd!)) return { text: `The stored charge falls below Qc at t = ${formatTime(tRec!)} (tq = ${formatTime(m.tqRun!)}): the SCR regains its blocking ability before the forward voltage returns.`, time: tRec }
    if (ahead(tFwd)) return { text: `The forward voltage returns at t = ${formatTime(tFwd!)} (tc = ${formatTime(m.tc!)}) while the charge is still ${m.refired ? 'above' : 'near'} Qc${m.refired ? ': the SCR will fire again without a gate pulse' : ''}.`, time: tFwd }
    if (m.refired) return { text: 'The forward voltage is back while q ≥ Qc: the SCR fires again — commutation failed.', time: null }
    return null
  }
  if (st.phase === 'turned off' && p.test === 'commutate' && st.ic > 0) return { text: `C charges up to V; then the load current freewheels through Dfw and decays with L/R = ${formatTime(p.l / p.r)}.`, time: null }
  return { text: st.ifw > 1e-9 ? `The load current ${formatA(st.ifw)} freewheels through Dfw and decays with L/R = ${formatTime(p.l / st.r)}; the SCR stays off until the next gate pulse.` : 'The SCR stays off until the next gate pulse.', time: null }
}

export function scrEnergyModel(st: ScrView, r: ScrRun): EnergyModel {
  const p = r.params
  const vl = st.vk - st.r * st.il
  const ledger = [
    { id: 'src', label: 'Source V', watts: -p.vs * (st.ia + st.ic), note: 'delivers V·(iA + iC)' },
    { id: 'scr', label: 'SCR', watts: st.vak * st.ia, note: 'vAK·iA as heat (VT0 + rT·iA while on)' },
    { id: 'c', label: 'Capacitor C', watts: st.vc * st.ic, note: 'stores ½·C·vC² while TA conducts' },
    { id: 'r', label: 'Load R', watts: st.r * st.il * st.il, note: 'R·iL² as heat' },
    { id: 'l', label: 'Load L', watts: vl * st.il, note: 'stores ½·L·iL² (+ storing, − releasing)' },
  ]
  let elMax = 0
  let ecMax = 0
  for (let k = 0; k < r.length; k++) {
    elMax = Math.max(elMax, 0.5 * p.l * r.signals.il[k] ** 2)
    ecMax = Math.max(ecMax, 0.5 * p.c * r.signals.vc[k] ** 2)
  }
  const el = 0.5 * p.l * st.il * st.il
  const ec = 0.5 * p.c * st.vc * st.vc
  return {
    ledger,
    stores: [
      { id: 'l', label: 'Load inductor ½·L·iL²', joules: el, fraction: el / Math.max(elMax, 1e-18), detail: `${vl * st.il >= 0 ? 'storing' : 'releasing'} ${formatSI(Math.abs(vl * st.il), 'W')}` },
      { id: 'c', label: 'Capacitor ½·C·vC²', joules: ec, fraction: ec / Math.max(ecMax, 1e-18), detail: st.ic > 0 ? `TA conducts: ${formatA(st.ic)}` : 'disconnected (TA off)' },
    ],
    balance: ledger.reduce((a, x) => a + x.watts, 0),
    tolerance: 1e-6 * Math.max(1e-9, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9,
  }
}

export function scrPath(st: ScrView): CurrentPath {
  const reasons: string[] = []
  let elements: string[]
  if (st.s === 'on' || st.s === 'lat') {
    elements = ['vs', 'scr', 'load']
    reasons.push(st.s === 'lat' ? 'the SCR is latched: it conducts without a gate current' : 'the gate current holds the SCR on (not latched yet)')
  } else if (st.ic > 0) {
    elements = ['vs', 'comm', 'load']
    reasons.push('TA has connected the capacitor across the SCR: the load current flows through C and the SCR current is zero')
  } else if (st.ifw > 1e-9) {
    elements = ['load', 'dfw']
    reasons.push('the SCR is off: the load inductance keeps its current flowing through the freewheeling diode')
  } else elements = []
  return { elements, text: scrPathText(st), reasons }
}

export function scrReadings(m: ScrMeasurements, r: ScrRun): Reading[] {
  const p = r.params
  const rd = (id: string, label: string, formatted: string, note: string): Reading => ({ id, label, ...splitUnit(formatted), note })
  const word = (id: string, label: string, value: string, note: string): Reading => ({ id, label, value, unit: '', note })
  if (p.test === 'commutate')
    return [
      word('result', 'Forced commutation', m.refired ? 'Failed' : m.commutated ? 'Turned off' : 'Not reached', m.refired ? 'fired again: tc < tq' : 'tc > tq'),
      rd('tc', 'Circuit turn-off time', formatTime(m.tc ?? NaN), 'tc ≈ C·V/IT'),
      rd('tq', 'Device turn-off time', formatTime(m.tq ?? NaN), 'tq = τ·ln(q0/Qc)'),
      rd('iT', 'On-state current before commutation', formatA(m.iT), 'IT'),
    ]
  if (p.test === 'hold')
    return [
      word('held', 'After the resistance step', m.dropped ? 'Dropped out' : 'Still ON', m.dropped ? 'current below IH' : 'current above IH'),
      rd('i2', 'Anode current after the step', formatA(m.dropped ? (m.iDrop ?? NaN) : m.iEnd), '(V − VT0)/(R2 + rT)'),
      rd('tDrop', 'Drop-out after the step', formatTime(m.tDrop ?? NaN), 'q falls below Qc'),
    ]
  return [
    word('latched', 'Latched', m.latched ? 'Yes' : 'No', 'iA ≥ IL before the gate ends'),
    rd('iaGateEnd', 'Anode current at the gate end', formatA(m.iaGateEnd), 'i = (V − VT0)/R·(1 − e^(−tR/L))'),
    rd('td', 'Turn-on delay', formatTime(m.td ?? NaN), 'td = τ·ln(IG/(IG − IGT))'),
    rd('tLatch', 'Gate start → iA = IL', formatTime(m.tLatch ?? NaN), 'td + RL rise to IL'),
  ]
}

export function scrWhy(r: ScrRun, st: ScrView, m: ScrMeasurements): WhyCard[] {
  const p = r.params
  const phaseCard: Record<ScrPhase, Omit<WhyCard, 'id' | 'question'>> = {
    blocking: {
      what: `The SCR blocks ${formatV(st.vak, false)} and no current flows. Its stored charge is ${st.qn.toFixed(2)}·Qc.`,
      why: 'An SCR is a four-layer p-n-p-n device: two transistors feeding each other. With no charge in their bases neither conducts, so the middle junction blocks the forward voltage.',
      equation: 'iA = 0 while q < Qc',
      physics: 'A forward-biased SCR only waits for a trigger: enough base charge to start the regeneration.',
      whatIf: 'A large dv/dt or a high temperature can also inject that charge — an unwanted turn-on (not modelled here).',
    },
    'gate charging': {
      what: `The gate injects ${formatA(st.ig)} into the SCR; the stored charge has reached ${st.qn.toFixed(2)}·Qc, but nothing conducts yet.`,
      why: `The gate current charges the base layers while recombination drains them (lifetime τ = ${formatTime(p.tau)}). Only when q reaches the critical charge Qc does the transistor pair regenerate.`,
      equation: `q(t) = (IH/IGT)·IG·τ·(1 − e^(−t/τ));  td = τ·ln(IG/(IG − IGT)) = ${formatTime(gateDelay(p))}`,
      physics: `A gate current at or below IGT = ${formatA(p.igt)} never gets there: its charge settles below Qc.`,
      whatIf: 'A stronger gate pulse fires the SCR sooner (shorter td).',
    },
    'ON, held by the gate': {
      what: `The SCR conducts ${formatA(st.ia)} and its voltage collapsed to ${formatV(st.vak, false)} — but it is NOT latched yet.`,
      why: `Right after firing only the region near the gate conducts. The SCR keeps itself on only once the anode current reaches the latching current IL = ${formatA(p.il)}; until then the gate must stay on.`,
      equation: 'i(t) = (V − VT0)/(R + rT)·(1 − e^(−t(R + rT)/L))',
      physics: `The load inductance L = ${formatSI(p.l, 'H')} limits how fast the current can rise: ${formatSI((p.vs - p.vt0) / p.l, 'A')}/s at first.`,
      whatIf: 'If the gate pulse ends now, the SCR turns off again and the current freewheels through Dfw.',
    },
    latched: {
      what: `The SCR is latched: it carries ${formatA(st.ia)} at ${formatV(st.vak, false)}${st.ig > 0 ? ' (the gate is still on, but no longer needed)' : ' with no gate current at all'}.`,
      why: `The anode current now feeds the base charge itself: q → τ·iA = ${(st.qn).toFixed(1)}·Qc. The gate has lost control — it cannot turn the SCR off.`,
      equation: `stays on while q ≥ Qc ⇔ iA > IH = Qc/τ = ${formatA(p.ih)}`,
      physics: `On-state loss vAK·iA = ${formatSI(st.vak * st.ia, 'W')}.`,
      whatIf: 'To turn it off the current must be brought below IH (holding) — or forced to zero by a commutation circuit.',
    },
    commutating: {
      what: `TA connected the charged capacitor across the SCR: vAK = ${formatV(st.vak)} and the SCR current is zero. The load current (${formatA(st.ic)}) now flows through C.`,
      why: `The SCR still holds ${st.qn.toFixed(2)}·Qc of stored charge. It can only block a FORWARD voltage again once q has recombined below Qc — that takes the turn-off time tq = τ·ln(q0/Qc) = ${formatTime(m.tq ?? NaN)}.`,
      equation: 'q(t) = q0·e^(−t/τ);  C·dvC/dt = iL  ⇒  tc ≈ C·V/IT',
      physics: `The capacitor gives the SCR tc = ${formatTime(m.tc ?? NaN)} of reverse bias (SIMULATION). ${m.refired ? 'That is less than tq: the forward voltage comes back too early.' : 'That is more than tq: the SCR recovers in time.'}`,
      whatIf: 'A larger capacitor or a smaller load current lengthens tc.',
    },
    'turned off': {
      what: `The SCR is off and blocks ${formatV(st.vak)}; its stored charge is ${st.qn.toFixed(2)}·Qc.`,
      why: m.refired ? 'It was forced off but fired again. Now it is off.' : m.dropped ? 'Its current was too small to keep the base charge above Qc: it dropped out (holding failed).' : m.failedLatch && !m.latched ? 'The gate ended before the anode current reached IL: the SCR never latched.' : 'Its stored charge decayed below Qc while it was reverse biased: it has recovered.',
      equation: 'iA = 0;  q < Qc',
      physics: st.ifw > 1e-9 ? `The load inductance keeps its current flowing through Dfw: ${formatA(st.ifw)}.` : st.ic > 0 ? `The capacitor keeps charging: ${formatV(st.vc)}.` : 'No current flows.',
      whatIf: 'A new gate pulse would fire it again.',
    },
  }
  return [
    { id: 'phase', question: `What is happening now? (${st.phase})`, ...phaseCard[st.phase] },
    {
      id: 'il-ih',
      question: 'Why is the latching current larger than the holding current?',
      what: `Latching current IL = ${formatA(p.il)}, holding current IH = ${formatA(p.ih)} (device data). SIMULATION: ${m.latched ? `iA reached IL ${formatTime(m.tLatch ?? NaN)} after the gate started` : `iA was only ${formatA(m.iaGateEnd)} when the gate ended`}.`,
      why: 'To latch, the conducting region must spread from the gate across the cathode — that needs more current. Once the whole area conducts, a much smaller current keeps the base charge above Qc.',
      equation: 'latch: iA(tg) ≥ IL;  hold: iA > IH = Qc/τ',
      physics: 'A current between IH and IL can keep a latched SCR on, but cannot latch it.',
      whatIf: 'An inductive load raises its current slowly: it needs a longer gate pulse (or a pulse train).',
    },
    {
      id: 'tq',
      question: 'Why must the reverse bias last longer than tq?',
      what: p.test === 'commutate' ? `SIMULATION: tc = ${formatTime(m.tc ?? NaN)}, tq = ${formatTime(m.tq ?? NaN)} → ${m.refired ? 'commutation FAILED (fired again)' : 'turned off'}.` : 'Switch the test to "Forced commutation" to see it.',
      why: 'Removing the current does not remove the stored charge: it recombines with the lifetime τ. Until q < Qc the SCR fires again by itself as soon as forward voltage returns.',
      equation: 'tq = τ·ln(q0/Qc) ≈ τ·ln(IT/IH)',
      physics: 'tq grows with the on-state current (more charge) and with temperature (longer lifetime).',
      whatIf: 'Inverter-grade SCRs have short lifetimes (small tq) — at the cost of a higher on-state voltage.',
    },
  ]
}

export function scrEventLabel(e: RunEvent): string {
  if (e.kind === 'gate-on') return 'Gate pulse starts'
  if (e.kind === 'gate-off') return 'Gate pulse ends'
  if (e.device === 'r-step') return 'Load resistance steps up (current falls)'
  const [f, t] = (e.device ?? '').split('→')
  const [fs, fa] = (f ?? '').split('|')
  const [ts, ta] = (t ?? '').split('|')
  if (fs === 'off' && (ts === 'on' || ts === 'lat')) return 'SCR fires (q reaches Qc)'
  if (fs === 'on' && ts === 'lat') return 'iA reaches IL: latched'
  if (fs === 'on' && ts === 'off') return 'Gate ended before IL: SCR turns off'
  if (fs === 'lat' && ts === 'rec') return 'TA fires: SCR reverse biased, current zero'
  if (fs === 'lat' && ts === 'off') return 'Stored charge below Qc: SCR drops out'
  if (fs === 'rec' && ts === 'off') return 'Charge below Qc: SCR recovered (tq)'
  if (fs === 'rec' && ts === 'lat') return 'Forward voltage back too early: SCR fires again'
  if (fa === 'r' && ta === 'f') return 'Forward voltage reapplied (tc ends)'
  if (ta === 'x' && fa !== 'x') return 'C reaches V: the load current moves to Dfw'
  return e.device ?? e.kind
}
export function scrEventWhy(e: RunEvent): string {
  return `iA = ${formatA(e.values.ia ?? 0)}, vAK = ${formatV(e.values.vak ?? 0)}, load ${formatA(e.values.il ?? 0)}, q/Qc = ${(e.values.q ?? 0).toFixed(2)}.`
}

/** SIMULATION vs THEORY (exact PWL solution) and the textbook relations. */
export function compareScr(r: ScrRun, m: ScrMeasurements): CompareResult {
  const p = r.params
  const ex = exactScr(p)
  const tb = textbookScr(p, m.iT > 0 ? m.iT : undefined)
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, t: { value: number | null; formula: string; note: string } | null, tol = 0.005) => {
    if (sim === null || exact === null || !Number.isFinite(sim) || !Number.isFinite(exact)) return
    const error = Math.abs(sim - exact) / Math.max(Math.abs(exact), 1e-30)
    const textbook: TextbookValue | null = t ? { key, value: t.value !== null && Number.isFinite(t.value) ? t.value : null, formula: t.formula, assumptions: [t.note] } : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, textbook, textbookError: textbook?.value ? (sim - textbook.value) / Math.abs(textbook.value) : null })
  }
  add('td', 'Turn-on delay td', 's', m.td, ex.td, { value: tb.td, formula: 'τ·ln(IG/(IG − IGT))', note: 'the gate charge from zero, no anode current yet (exact for this model)' })
  add('tLatch', 'Gate start → iA = IL', 's', m.tLatch, ex.tLatch, { value: tb.tLatch, formula: 'td + (L/R′)·ln(1/(1 − IL·R′/(V − VT0))), R′ = R + rT', note: 'the RL rise from the firing instant (exact for this model)' })
  add('iaGateEnd', 'Anode current at the gate end', 'A', m.iaGateEnd > 0 ? m.iaGateEnd : null, ex.iaGateEnd, { value: tb.iaGateEnd, formula: '(V − VT0)/R′·(1 − e^(−(tw − td)·R′/L))', note: 'latching needs this ≥ IL' })
  if (p.test === 'commutate') {
    add('iT', 'On-state current IT at tcom', 'A', m.iT > 0 ? m.iT : null, ex.iT, null)
    add('tc', 'Circuit turn-off time tc', 's', m.tc, ex.tc, { value: tb.tc, formula: 'C·V/IT', note: 'textbook: the load current stays at IT during commutation; here the load sees V + |vC| and its current grows a little' })
    add('tq', 'Device turn-off time tq', 's', m.tq, ex.tq, { value: tb.tq, formula: 'τ·ln(IT/IH)', note: 'textbook: the charge has settled at τ·IT before commutation' })
    add('tqRun', 'tq seen in the run (charge < Qc)', 's', m.tqRun, ex.tqRun, null)
  }
  if (p.test === 'hold') {
    add('tDrop', 'Drop-out after the step', 's', m.tDrop, ex.tDrop, { value: tb.tDrop, formula: 'τ·ln((I1 − I2)/(IH − I2))', note: 'textbook: the charge had settled at τ·I1 and the current falls to I2 at once (L/R2 ≪ τ)' })
    add('iDrop', 'Anode current at the drop-out', 'A', m.iDrop, ex.iDrop, { value: tb.i2, formula: '(V − VT0)/(R2 + rT)', note: 'the settled current after the step' })
  }
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: 'SIMULATION: trapezoidal time-stepping of the test circuit, every SCR state change located exactly. THEORY: the exact piecewise-linear solution (matrix exponential) of the same circuit.',
  }
}

export const SCR_ANALYSIS: Array<AnalysisCategory<ScrRun, ScrMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['td', 'tLatch', 'latchFlag', 'tc', 'tq', 'refireFlag', 'tDrop', 'dropFlag'] },
  { id: 'turnon', label: 'Turn-on and latching', rows: ['td', 'iaGateEnd', 'tLatch', 'latchFlag'], note: (_m, r) => `Shortest gate pulse that latches (theory): ${formatTime(textbookScr(r.params).twMin)}.` },
  { id: 'turnoff', label: 'Turn-off', rows: ['iT', 'vT', 'q0n', 'tc', 'tq', 'margin', 'refireFlag'] },
  { id: 'hold', label: 'Holding', rows: ['iDrop', 'tDrop', 'dropFlag'] },
  { id: 'stress', label: 'Stress', rows: ['iaPeak', 'vkPeak'] },
]

export const SCR_PARTS = [
  { id: 'vs', label: 'Source V' },
  { id: 'scr', label: 'SCR' },
  { id: 'gate', label: 'Gate driver' },
  { id: 'load', label: 'Load R + L' },
  { id: 'dfw', label: 'Freewheeling diode Dfw' },
  { id: 'comm', label: 'Commutation branch TA + C' },
]

type L = Lesson<ScrParams, ScrRun, ScrMeasurements, ScrView>
const gateWin = (r: ScrRun): [number, number] => [0, Math.min(r.params.tend, r.params.tg0 + 2.5 * r.params.tw + 3 * (scrMeasured(r).td ?? 0))]
const comWin = (r: ScrRun): [number, number] => [r.params.tcom - 0.3 * (r.params.tend - r.params.tcom), r.params.tend]
const holdWin = (r: ScrRun): [number, number] => [r.params.t2 - 0.15 * (r.params.tend - r.params.t2), r.params.tend]

export const SCR_LESSONS: L[] = [
  {
    id: 'trigger',
    title: 'Firing an SCR',
    summary: 'Gate charge, turn-on delay, and the moment it latches.',
    base: { test: 'latch' },
    check: {
      question: 'Why does the SCR not conduct the instant the gate current starts?',
      options: ['the gate current must first build up the critical charge in the SCR', 'the load inductance blocks the gate', 'the anode voltage is too low'],
      answer: 0,
      explain: 'The gate current charges the SCR’s base layers while recombination drains them. Only when the stored charge reaches Qc does the transistor pair regenerate and the SCR fire: that takes the turn-on delay td.',
    },
    steps: [
      {
        title: '1 · Blocking',
        at: (r) => 0.5 * r.params.tg0,
        window: gateWin,
        channels: ['ig', 'ia', 'vak', 'q'],
        look: 'Full voltage across the SCR, no current, no stored charge.',
        body: (st) => `The SCR blocks ${formatV(st.vak, false)}. Nothing flows: its stored charge is ${st.qn.toFixed(2)}·Qc.`,
      },
      {
        title: '2 · The gate charges it',
        at: (r) => r.params.tg0 + 0.5 * (scrMeasured(r).td ?? r.params.tw),
        window: gateWin,
        channels: ['ig', 'ia', 'vak', 'q'],
        look: 'q/Qc climbs while the gate current flows; the SCR still blocks.',
        body: (st, m, r) => `iG = ${formatA(st.ig)} (above IGT = ${formatA(r.params.igt)}). The stored charge has reached ${st.qn.toFixed(2)}·Qc; the SCR fires when it reaches 1 — after td = ${formatTime(m.td ?? NaN)} (SIMULATION).`,
      },
      {
        title: '3 · It fires — but is it latched?',
        at: (r) => {
          const m = scrMeasured(r)
          return r.params.tg0 + 0.5 * ((m.td ?? 0) + (m.tLatch ?? m.td ?? 0))
        },
        window: gateWin,
        channels: ['ig', 'ia', 'vak'],
        look: 'vAK collapsed; iA rises slowly through the inductive load.',
        body: (st, _m, r) => `The SCR conducts ${formatA(st.ia)} and drops only ${formatV(st.vak, false)}. The load inductance makes the current rise slowly; until it reaches IL = ${formatA(r.params.il)} only the gate keeps the SCR on.`,
      },
      {
        title: '4 · Latched: the gate is no longer needed',
        at: (r) => Math.min(r.params.tend, r.params.tg0 + r.params.tw + 0.4 * r.params.tw),
        window: gateWin,
        channels: ['ig', 'ia', 'q'],
        look: 'The gate pulse ended, the current keeps rising.',
        body: (st, m) => `iA reached IL ${formatTime(m.tLatch ?? NaN)} after the gate started, before the pulse ended. Now the gate is off and the SCR still carries ${formatA(st.ia)}: its own current keeps the charge at ${st.qn.toFixed(1)}·Qc.`,
      },
    ],
  },
  {
    id: 'latching',
    title: 'Latching current and gate pulse width',
    summary: 'An inductive load needs a long enough gate pulse.',
    base: { test: 'latch' },
    check: {
      question: 'With a more inductive load (larger L), to fire an SCR reliably you need…',
      options: ['a shorter gate pulse', 'a longer gate pulse', 'a smaller gate current'],
      answer: 1,
      explain: 'The anode current must reach IL before the gate pulse ends. A larger L makes the current rise more slowly, i = V/R·(1 − e^(−tR/L)) ≈ V·t/L, so it takes longer to reach IL.',
    },
    steps: [
      {
        title: '1 · A short pulse: it falls out',
        params: { tw: 8e-6 },
        at: (r) => r.params.tg0 + r.params.tw + 0.3 * r.params.tw,
        window: gateWin,
        channels: ['ig', 'ia', 'il', 'vak'],
        look: 'The SCR conducts during the pulse, then turns off.',
        body: (_st, m, r) => `tw = ${formatTime(r.params.tw)}: at the end of the pulse iA was only ${formatA(m.iaGateEnd)}, below IL = ${formatA(r.params.il)}. The SCR ${m.latched ? 'latched' : 'turned off again'}; the load current now freewheels through Dfw.`,
      },
      {
        title: '2 · A longer pulse: it latches',
        params: { tw: 20e-6 },
        at: (r) => r.params.tg0 + r.params.tw + 0.3 * r.params.tw,
        window: gateWin,
        channels: ['ig', 'ia', 'vak'],
        look: 'iA crosses IL while the gate is still on.',
        body: (_st, m, r) => `tw = ${formatTime(r.params.tw)}: iA reached IL after ${formatTime(m.tLatch ?? NaN)}, inside the pulse. ${m.latched ? 'Latched' : 'Not latched'} — the current keeps rising after the gate ends.`,
      },
      {
        title: '3 · Five times the inductance',
        params: { tw: 20e-6, l: 10e-3 },
        at: (r) => r.params.tg0 + r.params.tw + 0.3 * r.params.tw,
        window: gateWin,
        channels: ['ig', 'ia', 'vak'],
        look: 'The same pulse is now too short.',
        body: (_st, m, r) => `L = ${formatSI(r.params.l, 'H')}: the current rises five times more slowly and was only ${formatA(m.iaGateEnd)} at the gate end — ${m.latched ? 'still latched' : 'not latched'}. The shortest pulse that latches is now td + (L/R′)·ln(1/(1 − IL·R′/(V − VT0))) = ${formatTime(rlTimeTo(r.params, r.params.il) + (m.td ?? 0))}.`,
      },
    ],
  },
  {
    id: 'holding',
    title: 'Holding current',
    summary: 'A latched SCR stays on until its current falls below IH.',
    base: { test: 'hold' },
    check: {
      question: 'An anode current between IH and IL…',
      options: ['turns a latched SCR off', 'keeps a latched SCR on, but could not have latched it', 'latches the SCR without a gate'],
      answer: 1,
      explain: 'Holding needs only enough current to keep the stored charge above Qc (iA > IH); latching needs the larger IL while the gate is on. So a current between the two keeps the SCR on once it is latched.',
    },
    steps: [
      {
        title: '1 · Latched, carrying the load',
        at: (r) => 0.9 * r.params.t2,
        window: (r) => [0, r.params.tend],
        channels: ['ia', 'q'],
        look: 'The current has settled near V/R; the charge far above Qc.',
        body: (st) => `The SCR carries ${formatA(st.ia)} with no gate current. Its stored charge is ${st.qn.toFixed(0)}·Qc.`,
      },
      {
        title: '2 · The current drops below IH',
        at: (r) => {
          const m = scrMeasured(r)
          return r.params.t2 + 0.5 * (m.tDrop ?? r.params.tend - r.params.t2)
        },
        window: holdWin,
        channels: ['ia', 'q', 'vak'],
        look: 'iA collapses at once; the charge decays more slowly — then the SCR drops out.',
        body: (st, m, r) => `R steps to ${formatSI(r.params.r2, 'Ω')}: the current falls to ${formatA(st.ia)}, below IH = ${formatA(r.params.ih)}. The stored charge (${st.qn.toFixed(2)}·Qc) decays towards τ·iA < Qc — the SCR ${m.dropped ? `drops out ${formatTime(m.tDrop ?? NaN)} after the step` : 'stays on'}.`,
      },
      {
        title: '3 · Above IH: it holds',
        params: { r2: 1000 },
        at: (r) => r.params.tend - 1e-15,
        window: holdWin,
        channels: ['ia', 'q', 'vak'],
        look: 'The current settles above IH: the SCR stays latched.',
        body: (st, m, r) => `R2 = ${formatSI(r.params.r2, 'Ω')}: the current settles at ${formatA(st.ia)} — above IH = ${formatA(r.params.ih)} but below IL = ${formatA(r.params.il)}. The SCR is ${m.dropped ? 'off' : 'still ON'}: q/Qc = ${st.qn.toFixed(2)}.`,
      },
    ],
  },
  {
    id: 'commutation',
    title: 'Forced commutation and tq',
    summary: 'Reverse-bias the SCR for longer than its turn-off time.',
    base: { test: 'commutate' },
    check: {
      question: 'For a forced commutation to succeed, the circuit turn-off time tc must be…',
      options: ['longer than the device turn-off time tq', 'shorter than tq', 'equal to the gate pulse width'],
      answer: 0,
      explain: 'Zero current is not enough: the stored charge must recombine below Qc before forward voltage returns. The circuit must keep the SCR reverse biased for tc > tq, or it fires again on its own.',
    },
    steps: [
      {
        title: '1 · Conducting, full of charge',
        at: (r) => 0.95 * r.params.tcom,
        window: comWin,
        channels: ['ia', 'vak', 'q'],
        look: 'IT flows; the charge is far above Qc.',
        body: (_st, m) => `The SCR carries IT = ${formatA(m.iT)}. Its stored charge is q0 = ${m.q0n.toFixed(0)}·Qc — a latched SCR cannot be turned off by its gate.`,
      },
      {
        title: '2 · TA fires: reverse bias',
        at: (r) => r.params.tcom + 0.5 * (scrMeasured(r).tc ?? 0),
        window: comWin,
        channels: ['ia', 'vak', 'ic', 'q'],
        look: 'iA = 0 at once; vAK jumps negative and rises as C charges.',
        body: (st) => `The charged capacitor is now across the SCR: vAK = ${formatV(st.vak)}, iA = 0. The load current ${formatA(st.ic)} charges C. The stored charge decays: ${st.qn.toFixed(2)}·Qc.`,
      },
      {
        title: '3 · Forward voltage returns — after tq',
        at: (r) => r.params.tcom + (scrMeasured(r).tc ?? 0) + 0.2 * (scrMeasured(r).tc ?? 0),
        window: comWin,
        channels: ['vak', 'q', 'ia'],
        look: 'q/Qc fell below 1 before vAK crossed zero.',
        body: (_st, m) => `tc = ${formatTime(m.tc ?? NaN)} (C·V/IT), tq = ${formatTime(m.tq ?? NaN)}: the charge dropped below Qc ${m.margin !== null && m.margin > 0 ? `${formatTime(m.margin)} before` : 'AFTER'} the forward voltage returned. ${m.refired ? 'The SCR fired again!' : 'The SCR blocks: commutation succeeded.'}`,
      },
      {
        title: '4 · Half the capacitor: failure',
        params: { c: 3e-6 },
        at: (r) => r.params.tcom + (scrMeasured(r).tc ?? 0) + 0.2 * (scrMeasured(r).tc ?? 0),
        window: comWin,
        channels: ['vak', 'q', 'ia'],
        look: 'vAK crosses zero while q/Qc is still above 1: iA comes back.',
        body: (_st, m) => `C = 3 µF: tc = ${formatTime(m.tc ?? NaN)} is shorter than tq = ${formatTime(m.tq ?? NaN)}. When the forward voltage came back the charge was still above Qc: ${m.refired ? 'the SCR fired again without a gate — commutation failed' : 'it still recovered'}.`,
      },
    ],
  },
]

export const SCR_EXPERIMENTS: Array<Experiment<ScrParams, ScrMeasurements>> = [
  {
    id: 'cap',
    title: 'Halve the commutation capacitor',
    change: (p) => ({ c: p.c / 2 }),
    question: (p) => `C goes from ${formatSI(p.c, 'F')} to ${formatSI(p.c / 2, 'F')}. What happens at commutation?`,
    choices: ['It fails: the SCR fires again', 'It still turns off, with less margin', 'Nothing changes'],
    judge: (b, a) => (a.refired && !b.refired ? 0 : (a.margin ?? 0) < (b.margin ?? 0) - 1e-9 ? 1 : 2),
    rows: ['tc', 'tq', 'margin', 'refireFlag'],
    why: (b, a) => `tc ${formatTime(b.tc ?? NaN)} → ${formatTime(a.tc ?? NaN)} (C·V/IT halves), tq ${formatTime(b.tq ?? NaN)} → ${formatTime(a.tq ?? NaN)} (the device did not change). ${a.refired ? 'The forward voltage returned while the stored charge was still above Qc: the SCR fired again.' : 'Still enough time for the charge to recombine.'}`,
  },
  {
    id: 'gate',
    title: 'Shorten the gate pulse to 8 µs',
    change: () => ({ tw: 8e-6 }),
    question: (p) => `The gate pulse goes from ${formatTime(p.tw)} to 8 µs. Does the SCR still latch?`,
    choices: ['No: it turns off at the end of the pulse', 'Yes, as before', 'Yes, but later'],
    judge: (b, a) => (!a.latched ? 0 : (a.tLatch ?? 0) > (b.tLatch ?? 0) * 1.01 ? 2 : 1),
    rows: ['latchFlag', 'iaGateEnd', 'td'],
    why: (b, a) => `Anode current at the gate end ${formatA(b.iaGateEnd)} → ${formatA(a.iaGateEnd)}. ${a.latched ? 'It still reached IL in time.' : 'It had not reached IL when the gate ended: the SCR turned off and the load current moved to Dfw.'} The delay td = ${formatTime(a.td ?? NaN)} is the same — only the time left for the current to rise changed.`,
  },
  {
    id: 'tau',
    title: 'A slower device: double the lifetime τ',
    change: (p) => ({ tau: p.tau * 2 }),
    question: (p) => `The carrier lifetime goes from ${formatTime(p.tau)} to ${formatTime(p.tau * 2)} (same IH, IGT). What happens to tq?`,
    choices: ['tq about doubles', 'tq halves', 'tq stays the same'],
    judge: (b, a) => ((a.tq ?? 0) > 1.6 * (b.tq ?? 1) ? 0 : (a.tq ?? 0) < 0.7 * (b.tq ?? 1) ? 1 : 2),
    rows: ['tq', 'tc', 'margin', 'refireFlag'],
    why: (b, a) => `tq ${formatTime(b.tq ?? NaN)} → ${formatTime(a.tq ?? NaN)}: the charge recombines with τ, so tq = τ·ln(q0/Qc) scales with τ. ${a.refired ? `Now tq > tc = ${formatTime(a.tc ?? NaN)}: commutation fails.` : `Still shorter than tc = ${formatTime(a.tc ?? NaN)}.`}`,
  },
]

export function scrPredictions(seed: number): Array<PredictTask<ScrParams, ScrMeasurements>> {
  const ig = [0.06, 0.1, 0.2][seed % 3]
  const tw = [6e-6, 12e-6, 30e-6][(seed + 1) % 3]
  const r2 = [500, 2500, 5000][(seed + 2) % 3]
  const c = [3e-6, 4e-6, 10e-6][seed % 3]
  return [
    {
      id: 'td',
      prompt: `Gate current IG = ${formatA(ig)}, IGT = 30 mA, lifetime τ = 10 µs. Predict the turn-on delay.`,
      params: { test: 'latch', ig },
      kind: 'number',
      unit: 's',
      answer: (m) => m.td ?? NaN,
      tolerance: 0.03,
      hint: 'The charge rises like an RC charge towards (IG/IGT)·Qc; it fires at Qc.',
      theory: (p) => `td = τ·ln(IG/(IG − IGT)) = ${formatTime(gateDelay(p))}`,
    },
    {
      id: 'latch',
      prompt: `V = 100 V, R = 10 Ω, L = 2 mH, IL = 0.3 A, td ≈ 3.6 µs. The gate pulse lasts ${formatTime(tw)}. Does the SCR latch?`,
      params: { test: 'latch', tw },
      kind: 'choice',
      choices: ['Yes', 'No'],
      answer: (m) => (m.latched ? 0 : 1),
      hint: 'How long does the current need to reach IL? i ≈ V·t/L at first.',
      theory: (p) => `iA reaches IL after td + (L/R′)·ln(1/(1 − IL·R′/(V − VT0))) = ${formatTime(gateDelay(p) + rlTimeTo(p, p.il))} from the gate start; the pulse lasts ${formatTime(p.tw)}.`,
    },
    {
      id: 'hold',
      prompt: `A latched SCR (V = 100 V, VT0 = 1 V, IH = 50 mA). The load resistance steps to R2 = ${formatSI(r2, 'Ω')}. Does it stay on?`,
      params: { test: 'hold', r2 },
      kind: 'choice',
      choices: ['Yes, it stays on', 'No, it drops out'],
      answer: (m) => (m.dropped ? 1 : 0),
      hint: 'Compare the new current (V − VT0)/R2 with IH.',
      theory: (p) => `I2 = (V − VT0)/(R2 + rT) = ${formatA((p.vs - p.vt0) / (p.r2 + p.rt))} ${(p.vs - p.vt0) / (p.r2 + p.rt) > p.ih ? '>' : '<'} IH = ${formatA(p.ih)}`,
    },
    {
      id: 'commutate',
      prompt: `Forced commutation of about 7.6 A with C = ${formatSI(c, 'F')} charged to 100 V; the SCR's tq is about 50 µs. Does it turn off?`,
      params: { test: 'commutate', c },
      kind: 'choice',
      choices: ['Yes, it turns off', 'No, it fires again'],
      answer: (m) => (m.refired ? 1 : 0),
      hint: 'tc ≈ C·V/IT must be longer than tq.',
      theory: (p) => `tc ≈ C·V/IT = ${formatTime((p.c * p.vs) / 7.6)} (a little less in the simulation: the load current grows during commutation) vs tq ≈ τ·ln(IT/IH) = ${formatTime(p.tau * Math.log(7.6 / p.ih))}`,
    },
  ]
}

export { SCR_DEFAULTS }
