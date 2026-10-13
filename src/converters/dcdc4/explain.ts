import type { NextConsequence, EnergyModel } from '../../workspace/contract.ts'
import type { WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import { nextRunEvent } from '../cursor.ts'
import { converterIndexAt } from '../engine.ts'
import type { RunEvent } from '../types.ts'
import type { BidiMeasurements, BidiRun, CoupledMeasurements, CoupledRun } from './measure.ts'
import type { CoupledKind } from './params.ts'
import { coupledBoundary, coupledLaw, coupledVc1Law } from './theory.ts'

/**
 * Explanations of the advanced converters, generated from the simulated state at the cursor (no language
 * model): every number in a sentence is read from the trace, and the sentence chosen depends on that
 * state (which device conducts, which way the currents flow).
 */

const NAME: Record<CoupledKind, string> = { cuk: 'Ćuk', sepic: 'SEPIC', zeta: 'Zeta' }
export const coupledName = (k: CoupledKind) => NAME[k]
export const formatSlopeA = (x: number) => `${x >= 0 ? '+' : '−'}${formatSI(Math.abs(x) * 1e-6, 'A/µs')}`
export const formatSlopeV = (x: number) => `${x >= 0 ? '+' : '−'}${formatSI(Math.abs(x) * 1e-3, 'V/ms')}`

// ── Coupled converters (Ćuk, SEPIC, Zeta) ─────────────────────────────────────────────────────────────

export type CoupledInterval = 'on' | 'off' | 'idle'

export interface CoupledState {
  kind: CoupledKind
  k: number
  t: number
  phase: number
  interval: CoupledInterval
  gate: boolean
  qOn: boolean
  dOn: boolean
  il1: number
  il2: number
  vl1: number
  vl2: number
  vc1: number
  ic1: number
  vout: number
  vc: number
  ic: number
  io: number
  iq: number
  vq: number
  id: number
  vd: number
  iin: number
  vsw: number
  vb: number
  el: number
  ec: number
  pin: number
  pout: number
  dil1dt: number
  dil2dt: number
  dvc1dt: number
  dvcdt: number
  /** Power into L1 + L2 (+ storing) and into C1 (+ charging). */
  pL: number
  pC1: number
  pC: number
  path: string[]
  pathText: string
}

export const COUPLED_INTERVAL: Record<CoupledInterval, string> = {
  on: 'Switch ON interval (Q1 ON, D1 OFF)',
  off: 'Switch OFF interval (D1 ON)',
  idle: 'Idle interval (DCM: Q1 and D1 OFF, iD = 0)',
}

const PATHS: Record<CoupledKind, Record<CoupledInterval, { parts: string[]; text: string }>> = {
  cuk: {
    on: { parts: ['vin', 'l1', 'sw', 'q1', 'c1', 'b', 'l2', 'out', 'c', 'r'], text: 'Vin+ → L1 → Q1 → ground: L1 charges from the source. At the same time C1 discharges through Q1 into L2 and the load (current is pulled OUT of the output).' },
    off: { parts: ['vin', 'l1', 'sw', 'c1', 'b', 'd1', 'l2', 'out', 'c', 'r'], text: 'Vin+ → L1 → C1 → D1 → ground: L1 (with the source) recharges C1. At the same time L2 freewheels through D1: load → L2 → D1 → ground.' },
    idle: { parts: ['vin', 'l1', 'sw', 'c1', 'b', 'l2', 'out', 'c', 'r'], text: 'Q1 and D1 OFF: one series loop Vin+ → L1 → C1 → L2 → load → ground carries a constant current; the diode current iL1 + iL2 is zero.' },
  },
  sepic: {
    on: { parts: ['vin', 'l1', 'sw', 'q1', 'c1', 'b', 'l2', 'c', 'r', 'out'], text: 'Vin+ → L1 → Q1 → ground: L1 charges. At the same time C1 discharges into L2 through Q1 (C1 → Q1 → ground → L2 → C1). C alone feeds the load.' },
    off: { parts: ['vin', 'l1', 'sw', 'c1', 'b', 'd1', 'out', 'l2', 'c', 'r'], text: 'Vin+ → L1 → C1 → D1 → output: L1 recharges C1 and feeds the load; L2 adds its current through D1 (ground → L2 → D1 → output).' },
    idle: { parts: ['vin', 'l1', 'sw', 'c1', 'b', 'l2', 'c', 'r', 'out'], text: 'Q1 and D1 OFF: one loop Vin+ → L1 → C1 → L2 → ground carries a constant current; the output is cut off and C alone feeds the load.' },
  },
  zeta: {
    on: { parts: ['vin', 'q1', 'sw', 'l1', 'c1', 'b', 'l2', 'out', 'c', 'r'], text: 'Vin+ → Q1 → L1 → ground: L1 charges. At the same time Vin+ → Q1 → C1 → L2 → output: the source feeds the load through C1 and L2.' },
    off: { parts: ['l1', 'sw', 'c1', 'b', 'd1', 'l2', 'out', 'c', 'r'], text: 'L1 → ground → D1 → C1 → L1: L1 releases its energy into C1. At the same time L2 freewheels: L2 → output → load → ground → D1 → L2.' },
    idle: { parts: ['l1', 'sw', 'c1', 'b', 'l2', 'out', 'c', 'r'], text: 'Q1 and D1 OFF: one loop L1 → C1 → L2 → load → ground carries a constant current; the diode current iL1 + iL2 is zero.' },
  },
}

export function coupledStateAt(r: CoupledRun, k: number): CoupledState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s: Record<string, number> = {}
  for (const key in r.signals) s[key] = r.signals[key][i]
  const qOn = r.devices[0].on[i] === 1
  const dOn = r.devices[1].on[i] === 1
  const interval: CoupledInterval = qOn ? 'on' : dOn ? 'off' : 'idle'
  const t = r.time[i]
  const path = PATHS[p.kind][interval]
  return {
    kind: p.kind,
    k: i,
    t,
    phase: t / p.ts - Math.floor(t / p.ts + 1e-9),
    interval,
    gate: s.gate > 0.5,
    qOn,
    dOn,
    il1: s.il1,
    il2: s.il2,
    vl1: s.vl1,
    vl2: s.vl2,
    vc1: s.vc1,
    ic1: s.ic1,
    vout: s.vout,
    vc: s.vc,
    ic: s.ic,
    io: s.io,
    iq: s.iq,
    vq: s.vq,
    id: s.id,
    vd: s.vd,
    iin: s.iin,
    vsw: s.vsw,
    vb: s.vb,
    el: s.el,
    ec: s.ec,
    pin: s.pin,
    pout: s.pout,
    dil1dt: s.vl1 / p.l1,
    dil2dt: s.vl2 / p.l2,
    dvc1dt: s.ic1 / p.c1,
    dvcdt: s.ic / p.c,
    pL: s.vl1 * s.il1 + s.vl2 * s.il2,
    pC1: s.vc1 * s.ic1,
    pC: s.vc * s.ic,
    path: path.parts,
    pathText: path.text,
  }
}

export function coupledStatus(st: CoupledState): { headline: string; facts: string[]; tone: 'on' | 'off' | 'idle' } {
  const both = (a: number, b: number, up: string, down: string) => (a > 0 && b > 0 ? up : a < 0 && b < 0 ? down : 'iL1 and iL2 change in opposite directions')
  if (st.interval === 'on') return { headline: 'Switch ON', facts: [both(st.dil1dt, st.dil2dt, 'both inductors charging', 'both inductor currents falling'), `C1 ${st.ic1 * st.vc1 >= 0 ? 'charging' : 'discharging'}`, st.dOn ? 'diode ON as well (C1 has swung through zero)' : 'diode OFF'], tone: 'on' }
  if (st.interval === 'off') return { headline: 'Switch OFF', facts: ['diode ON', both(st.dil1dt, st.dil2dt, 'inductor currents rising', 'both inductors discharging'), `C1 ${st.ic1 * st.vc1 >= 0 ? 'charging' : 'discharging'}`], tone: 'off' }
  return { headline: 'Switch OFF', facts: ['diode OFF', `iD = 0: L1 and L2 circulate ${formatA(Math.abs(st.il1))} (discontinuous conduction)`], tone: 'idle' }
}

function lastEvent(r: { events: RunEvent[]; params: { dt: number } }, kind: RunEvent['kind'], t: number): RunEvent | undefined {
  let found: RunEvent | undefined
  for (const e of r.events) {
    if (e.time > t + r.params.dt * 1e-6) break
    if (e.kind === kind) found = e
  }
  return found
}

export function coupledWhy(r: CoupledRun, st: CoupledState, m: CoupledMeasurements): WhyCard[] {
  const p = r.params
  const kind = st.kind
  const N = NAME[kind]
  const cards: WhyCard[] = []
  const iD = st.il1 + st.il2
  const b = coupledBoundary(p)
  const offAt = lastEvent(r, 'gate-off', st.t)
  const zeroAt = lastEvent(r, 'il-zero', st.t)
  // 1. The diode
  if (st.interval === 'on' && st.dOn) {
    cards.push({
      id: 'diode',
      question: 'Why does D1 conduct while Q1 is ON?',
      what: `Both devices conduct: iQ = ${formatA(st.iq, true)}, iD = ${formatA(st.id)}. The coupling capacitor holds only vC1 = ${formatV(st.vc1)}.`,
      why: 'C1 is too small for this load: it discharges so far during the ON interval that its voltage no longer reverse-biases D1, and the diode starts to conduct in parallel with the switch.',
      equation: `vC1 = ${formatV(st.vc1)} (its ripple is ${formatV(m.vc1PP, false)} peak-to-peak, against an average of ${formatV(m.vc1Avg, false)})`,
      physics: 'The ideal analysis assumes vC1 is almost constant. When ΔVC1 approaches VC1 the converter leaves the textbook operation and the ideal conversion law no longer holds.',
      whatIf: 'A larger C1 (or a lighter load) restores the normal operation, where D1 is reverse-biased by about Vin + |Vout| while Q1 is ON.',
    })
  } else if (st.interval === 'on') {
    cards.push({
      id: 'diode',
      question: 'Why is D1 OFF?',
      what: `Q1 conducts the SUM of both inductor currents: iQ = iL1 + iL2 = ${formatA(st.iq)}. D1 is OFF with vD = ${formatV(st.vd)}.`,
      why:
        kind === 'cuk'
          ? `Q1 ties node A to ground, so the far plate of C1 (node B, D1's anode) is pulled down to −vC1 = ${formatV(st.vb)}: D1 is reverse biased by about vC1 = ${formatV(st.vc1, false)}.`
          : kind === 'sepic'
            ? `Q1 ties node A to ground, so node B (D1's anode) is pulled down to −vC1 = ${formatV(st.vb)} while D1's cathode sits at Vout = ${formatV(st.vout)}: reverse biased by about Vin + Vout.`
            : `Q1 ties node A to Vin, so node B (D1's cathode) is lifted to Vin + vC1 = ${formatV(st.vb)} while its anode is at ground: reverse biased by about Vin + Vout.`,
      equation: kind === 'cuk' ? `vD = vB − 0 = ${formatV(st.vd)} < Vf` : kind === 'sepic' ? `vD = vB − Vout = ${formatV(st.vd)} < Vf` : `vD = 0 − vB = ${formatV(st.vd)} < Vf`,
      physics: 'The coupling capacitor shifts the voltage of node B by vC1: whenever Q1 moves node A, node B moves by the same amount. That is how one switch controls both halves of the circuit.',
      whatIf: `D1 must block ${formatV(m.vdReverseMax, false)} (the largest reverse voltage in this run) — the same as the switch: Vin + |Vout|.`,
    })
  } else if (st.interval === 'off') {
    cards.push({
      id: 'diode',
      question: 'Why did D1 turn ON?',
      what: `Q1 turned OFF${offAt ? ` at t = ${formatTime(offAt.time)}` : ''}. Now D1 carries iL1 + iL2 = ${formatA(st.id)}.`,
      why: `Neither inductor current can stop instantly. With Q1 open, the only path for both of them is through D1, so the node voltages move until D1 is forward biased (vD = ${formatV(st.vd)}).`,
      equation: `iD = iL1 + iL2 = ${formatA(st.il1)} + ${formatA(st.il2)} = ${formatA(iD)}`,
      physics: 'The two inductors act as current sources; the diode is the switch that the circuit itself closes when Q1 opens.',
      whatIf: `If the load is light, iL1 + iL2 falls to zero before Q1 turns on again and D1 turns off early: discontinuous conduction (theory: CCM needs Le = L1‖L2 > ${formatSI(b.leCrit, 'H')}; here Le = ${formatSI(b.le, 'H')}).`,
    })
  } else {
    cards.push({
      id: 'diode',
      question: 'Why is D1 OFF while Q1 is OFF?',
      what: `Both devices are OFF, but the inductor currents are NOT zero: iL1 = ${formatA(st.il1, true)}, iL2 = ${formatA(st.il2, true)}.`,
      why: `Their sum — the diode current — fell to zero${zeroAt ? ` at t = ${formatTime(zeroAt.time)}` : ''}. D1 cannot conduct backwards, so it turned off, and the two inductors now form one series loop through C1 with iL2 = −iL1.`,
      equation: `iD = iL1 + iL2 = ${formatA(iD, true)} ≈ 0`,
      physics: `This is DCM in a ${N}: unlike the buck-boost, the inductor currents do not fall to zero — only the diode current does. The loop current stays nearly constant because the voltage around the loop averages to zero.`,
      whatIf: `A larger Le = L1‖L2 (now ${formatSI(b.le, 'H')}) or a heavier load returns the converter to CCM (theory boundary: Le,crit = (1 − D)²·R/(2·fs) = ${formatSI(b.leCrit, 'H')}).`,
    })
  }
  // 2. The inductor currents
  const rising1 = st.dil1dt > 0
  cards.push({
    id: 'il',
    question: st.interval === 'idle' ? 'Why are iL1 and iL2 almost constant?' : `Why are both inductor currents ${rising1 ? 'rising' : 'falling'}?`,
    what: `iL1 = ${formatA(st.il1, true)} (${formatSlopeA(st.dil1dt)}), iL2 = ${formatA(st.il2, true)} (${formatSlopeA(st.dil2dt)}).`,
    why:
      st.interval === 'on'
        ? `While Q1 is ON both inductors see about +Vin: vL1 = ${formatV(st.vl1)}, vL2 = ${formatV(st.vl2)} — ${kind === 'zeta' ? 'L1 sits directly across the source' : 'L1 sits across the source'}, and L2 sees ${kind === 'sepic' ? 'vC1 ≈ Vin' : 'vC1 minus the output, ≈ Vin'}.`
        : st.interval === 'off'
          ? `While D1 conducts both inductors see about −|Vout|: vL1 = ${formatV(st.vl1)}, vL2 = ${formatV(st.vl2)}. They release energy.`
          : `In the idle loop the two inductor voltages almost cancel the rest of the loop: vL1 = ${formatV(st.vl1)}, vL2 = ${formatV(st.vl2)}.`,
    equation: `diL1/dt = vL1/L1 = ${formatSlopeA(st.dil1dt)},  diL2/dt = vL2/L2 = ${formatSlopeA(st.dil2dt)}`,
    physics: 'Both inductors are switched by the same Q1 and see the same voltage pattern (+Vin, then −|Vout|). That is why their volt-second balance gives one conversion law.',
    whatIf: `Ripple ∝ 1/L: doubling L1 halves ΔiL1 (now ${formatA(m.il1PP)}) without changing ΔiL2 (now ${formatA(m.il2PP)}). The averages are set by the power: IL1 = Iin = ${formatA(m.il1Avg)}, IL2 = |Iout| = ${formatA(m.il2Avg)}.`,
  })
  // 3. The coupling capacitor
  const charging = st.vc1 * st.ic1 >= 0
  cards.push({
    id: 'c1',
    question: `Why is C1 ${charging ? 'charging' : 'discharging'} now?`,
    what: `vC1 = ${formatV(st.vc1, false)} (average ${formatV(m.vc1Avg, false)}), iC1 = ${formatA(st.ic1, true)}.`,
    why:
      st.interval === 'on'
        ? `With Q1 ON, C1 is connected to L2: it carries iL2 = ${formatA(st.il2)} and gives its energy to the output side.`
        : st.interval === 'off'
          ? `With Q1 OFF, C1 is in series with L1: it carries iL1 = ${formatA(st.il1)} and is recharged from the input side.`
          : 'In the idle loop C1 carries the circulating current of L1 and L2.',
    equation: `${coupledVc1Law(kind)} (theory, CCM) · C1·dvC1/dt = iC1 = ${formatA(st.ic1, true)}`,
    physics: `C1 is the energy shuttle: charged by the input side while Q1 is OFF, discharged into the output side while Q1 is ON. Charge balance (iL1 for (1 − D)·Ts in, iL2 for D·Ts out) fixes IL2/IL1 = (1 − D)/D.`,
    whatIf: `Doubling C1 halves its ripple (now ${formatV(m.vc1PP, false)} peak-to-peak) but not its average. A too-small C1 resonates with L1 and L2 and the converter stops behaving like the ideal law.`,
  })
  // 4. The output
  const growing = st.vc * st.ic > 0
  cards.push({
    id: 'vout',
    question: `Why is ${kind === 'cuk' ? '|Vout|' : 'Vout'} ${growing ? 'rising' : 'falling'} now?`,
    what: `Vout = ${formatV(st.vout)}; the output capacitor current is iC = ${formatA(st.ic, true)}, the load takes ${formatA(Math.abs(st.io))}.`,
    why:
      kind === 'sepic'
        ? st.interval === 'off'
          ? 'D1 delivers iL1 + iL2 to the output; when it exceeds the load current, C charges.'
          : 'Nothing feeds the output now (D1 is OFF): C alone supplies the load — the output current is pulsed, as in a boost.'
        : `L2 feeds the output continuously (${kind === 'cuk' ? 'pulling current out of it' : 'pushing current into it'}): C takes only the ripple of iL2, as in a buck.`,
    equation: 'C·dvC/dt = iC = i_feed − iR',
    physics: kind === 'sepic' ? 'A SEPIC has a continuous INPUT current (L1) but a pulsed output current.' : `A ${N} has a continuous ${kind === 'cuk' ? 'input AND output current' : 'output current (but a pulsed input current through Q1)'}.`,
    whatIf: `Output ripple now ${formatSI(m.voutPP, 'V')} peak-to-peak; ∝ 1/C${p.esr > 0 ? ' for the capacitor part, plus the ESR step' : ''}.`,
  })
  // 5. The gate
  cards.push({
    id: 'gate',
    question: `Why is Q1 ${st.qOn ? 'ON' : 'OFF'}?`,
    what: `The PWM gate is ${st.gate ? 'HIGH' : 'LOW'} (${(st.phase * 100).toFixed(1)} % into the period).`,
    why: `The PWM keeps Q1 ON for the first D = ${(p.duty * 100).toFixed(0)} % of every period Ts = ${formatTime(p.ts)}.`,
    equation: `ton = D·Ts = ${formatTime(p.duty * p.ts)}`,
    physics: 'Q1 is the only controlled device: the diode and C1 follow it.',
    whatIf: `Below D = 50 % the ${N} steps down, above it steps up (ideal CCM: ${coupledLaw(kind)}).`,
  })
  return cards
}

export function coupledEventLabel(e: RunEvent): string {
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
      return 'iL1 + iL2 reaches zero (DCM)'
    default:
      return `${e.device ?? ''} ${e.kind}`
  }
}

export function coupledEventWhy(e: RunEvent): string {
  const v = e.values
  switch (e.kind) {
    case 'gate-on':
      return `The period starts: Q1 closes and node A moves to ${formatV(v.vsw ?? 0)}. Both inductor currents start rising (iL1 = ${formatA(v.il1 ?? 0)}, iL2 = ${formatA(v.il2 ?? 0)}).`
    case 'gate-off':
      return `D·Ts has elapsed: Q1 opens while it carries iL1 + iL2 = ${formatA((v.il1 ?? 0) + (v.il2 ?? 0))}.`
    case 'diode-on':
      return `Both inductors keep their currents; with Q1 open their only path is D1, which now carries ${formatA(v.id ?? 0)}.`
    case 'diode-off':
      return (v.gate ?? 0) > 0.5 ? 'Q1 took over the inductor currents and the coupling capacitor reverse-biased D1.' : 'The diode current iL1 + iL2 fell to zero; D1 cannot conduct backwards.'
    case 'il-zero':
      return `The diode current reached zero while iL1 = ${formatA(v.il1 ?? 0, true)} and iL2 = ${formatA(v.il2 ?? 0, true)} still flow — they circulate through C1 until Q1 turns on (DCM).`
    default:
      return ''
  }
}

export function coupledNextConsequence(r: CoupledRun, st: CoupledState): NextConsequence | null {
  const k = converterIndexAt(r, st.t)
  const next = (kinds: string[]) => nextRunEvent(r, k, kinds) ?? undefined
  const at = (t: number) => `t = ${formatTime(t)}`
  if (st.interval === 'on') {
    const e = next(['gate-off'])
    return e ? { text: `Both inductor currents keep rising until the gate goes LOW at ${at(e.time)} — then Q1 opens and D1 must carry iL1 + iL2.`, time: e.time } : null
  }
  if (st.interval === 'off') {
    const e = next(['gate-on', 'il-zero', 'diode-off'])
    if (!e) return null
    if (e.kind === 'gate-on') return { text: `D1 keeps carrying iL1 + iL2 (now ${formatA(st.id)}, falling) until Q1 turns ON again at ${at(e.time)}.`, time: e.time }
    return { text: `iL1 + iL2 reaches zero at ${at(e.time)}: D1 turns OFF while the inductor currents keep circulating (discontinuous conduction).`, time: e.time }
  }
  const e = next(['gate-on'])
  return e ? { text: `The loop current circulates until Q1 turns ON at ${at(e.time)}.`, time: e.time } : null
}

export function coupledEnergy(st: CoupledState, m: CoupledMeasurements, r: CoupledRun): EnergyModel {
  const p = r.params
  const ledger = [
    { id: 'src', label: 'Source Vin', watts: -st.pin, note: 'supplies energy (− = delivering)' },
    { id: 'q', label: 'Switch Q1', watts: st.vq * st.iq, note: 'conduction loss vQ·iQ' },
    { id: 'd', label: 'Diode D1', watts: st.vd * st.id, note: 'conduction loss vD·iD' },
    { id: 'l', label: 'Inductors L1 + L2', watts: st.pL, note: 'vL1·iL1 + vL2·iL2 (+ storing, − releasing)' },
    { id: 'c1', label: 'Coupling capacitor C1', watts: st.pC1, note: 'vC1·iC1 (+ charging, − discharging)' },
    { id: 'c', label: 'Output capacitor C', watts: st.pC, note: 'vC·iC' },
    { id: 'rl', label: 'DCR + ESR', watts: p.rl * (st.il1 * st.il1 + st.il2 * st.il2) + p.esr * st.ic * st.ic, note: 'heat in the winding and capacitor resistances' },
    { id: 'r', label: 'Load R', watts: st.pout, note: 'always absorbing' },
  ]
  const ec1 = 0.5 * p.c1 * st.vc1 * st.vc1
  const ec1Max = 0.5 * p.c1 * m.vc1Max * m.vc1Max
  return {
    ledger,
    stores: [
      { id: 'l', label: 'Inductors ½·L1·iL1² + ½·L2·iL2²', joules: st.el, fraction: st.el / Math.max(m.elMax, 1e-15), detail: `${st.pL >= 0 ? 'storing' : 'releasing'} ${formatW(Math.abs(st.pL))}` },
      { id: 'c1', label: 'Coupling capacitor ½·C1·vC1²', joules: ec1, fraction: ec1 / Math.max(ec1Max, 1e-15), detail: `${st.pC1 >= 0 ? 'charging' : 'discharging'} ${formatW(Math.abs(st.pC1))}` },
    ],
    balance: ledger.reduce((a, x) => a + x.watts, 0),
    tolerance: 1e-6 * Math.max(1e-12, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9,
    summary: `Per period C1 takes ${formatSI((m.vc1PP * p.c1 * m.vc1Avg) || 0, 'J')} from the input side and hands it to the output side (≈ C1·VC1·ΔVC1).`,
  }
}

// ── Bidirectional half-bridge ─────────────────────────────────────────────────────────────────────────

export type BidiLeg = 'upper' | 'lower' | 'none'

export interface BidiState {
  k: number
  t: number
  phase: number
  g1: boolean
  g2: boolean
  q1On: boolean
  d1On: boolean
  q2On: boolean
  d2On: boolean
  /** Which leg carries iL, and through which device(s). */
  leg: BidiLeg
  carrier: string
  il: number
  vl: number
  vsw: number
  vlv: number
  vc: number
  ic: number
  ib: number
  ihv: number
  iq1: number
  iq2: number
  id1: number
  id2: number
  vq1: number
  vq2: number
  vd1: number
  vd2: number
  el: number
  ec: number
  phv: number
  plv: number
  pbat: number
  prb: number
  dildt: number
  path: string[]
  pathText: string
}

export function bidiStateAt(r: BidiRun, k: number): BidiState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s: Record<string, number> = {}
  for (const key in r.signals) s[key] = r.signals[key][i]
  const on = (j: number) => r.devices[j].on[i] === 1
  const q1On = on(0)
  const d1On = on(1)
  const q2On = on(2)
  const d2On = on(3)
  const upper = (q1On && Math.abs(s.iq1) > 1e-9) || d1On
  const lower = (q2On && Math.abs(s.iq2) > 1e-9) || d2On
  const leg: BidiLeg = upper ? 'upper' : lower ? 'lower' : q1On ? 'upper' : q2On ? 'lower' : 'none'
  const devs = leg === 'upper' ? [q1On && 'Q1', d1On && 'D1'] : leg === 'lower' ? [q2On && 'Q2', d2On && 'D2'] : []
  const carrier = devs.filter(Boolean).join(' + ') || 'none'
  const pos = s.il >= 0
  let path: string[]
  let pathText: string
  if (leg === 'upper')
    [path, pathText] = pos
      ? [['hv', 'q1', 'sw', 'l', 'lv', 'c', 'bat'], `Bus+ → ${carrier} → L → battery: the bus drives current into L (buck: power flows bus → battery).`]
      : [['bat', 'c', 'lv', 'l', 'sw', 'q1', 'd1', 'hv'], `Battery → L → ${carrier} → bus+: L pushes its current UP into the bus (boost: power flows battery → bus)${q1On && !d1On ? ', through Q1 conducting backwards' : ''}.`]
  else if (leg === 'lower')
    [path, pathText] = pos
      ? [['q2', 'd2', 'sw', 'l', 'lv', 'c', 'bat'], `Ground → ${carrier} → L → battery: L freewheels and keeps charging the battery${q2On && !d2On ? ' (Q2 conducts backwards: synchronous rectification)' : ''}.`]
      : [['bat', 'c', 'lv', 'l', 'sw', 'q2'], `Battery → L → ${carrier} → ground: the battery stores energy in L (boost: charging the inductor).`]
  else [path, pathText] = [['bat', 'c', 'lv'], 'Nothing conducts (dead time with iL = 0): the battery and C hold the LV side.']
  const t = r.time[i]
  return {
    k: i,
    t,
    phase: t / p.ts - Math.floor(t / p.ts + 1e-9),
    g1: s.gate1 > 0.5,
    g2: s.gate2 > 0.5,
    q1On,
    d1On,
    q2On,
    d2On,
    leg,
    carrier,
    il: s.il,
    vl: s.vl,
    vsw: s.vsw,
    vlv: s.vlv,
    vc: s.vc,
    ic: s.ic,
    ib: s.ib,
    ihv: s.ihv,
    iq1: s.iq1,
    iq2: s.iq2,
    id1: s.id1,
    id2: s.id2,
    vq1: s.vq1,
    vq2: s.vq2,
    vd1: s.vd1,
    vd2: s.vd2,
    el: s.el,
    ec: s.ec,
    phv: s.phv,
    plv: s.plv,
    pbat: s.pbat,
    prb: s.prb,
    dildt: s.vl / p.l,
    path,
    pathText,
  }
}

export function bidiStatus(st: BidiState): { headline: string; facts: string[]; tone: 'on' | 'off' | 'idle' } {
  const dir = st.il >= 0 ? 'iL toward the battery' : 'iL toward the bus'
  if (st.leg === 'none') return { headline: 'Dead time', facts: ['nothing conducts', 'iL = 0'], tone: 'idle' }
  const head = st.leg === 'upper' ? (st.q1On ? 'Upper switch Q1 ON' : 'Dead time: D1 conducts') : st.q2On ? 'Lower switch Q2 ON' : 'Dead time: D2 conducts'
  return { headline: head, facts: [dir, st.dildt >= 0 ? 'iL rising' : 'iL falling', `bus power ${st.phv >= 0 ? 'out of' : 'into'} the bus now`], tone: st.leg === 'upper' ? 'on' : 'off' }
}

export function bidiWhy(r: BidiRun, st: BidiState, m: BidiMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const pos = st.il >= 0
  // 1. Which device carries the current
  cards.push({
    id: 'leg',
    question: st.leg === 'none' ? 'Why does nothing conduct?' : `Why does ${st.carrier} carry the inductor current?`,
    what: `iL = ${formatA(st.il, true)} (+ = toward the battery). Gates: Q1 ${st.g1 ? 'HIGH' : 'LOW'}, Q2 ${st.g2 ? 'HIGH' : 'LOW'}. The switch node is at ${formatV(st.vsw)}.`,
    why:
      st.leg === 'none'
        ? 'Both gates are LOW (dead time) and iL reached zero: no diode is forward biased, so no device conducts until the next gate edge.'
        : st.leg === 'upper'
          ? st.q1On
            ? pos
              ? 'Q1 is gated ON and iL flows forward through it: the switch node is tied to the bus.'
              : `Q1 is gated ON and iL flows BACKWARDS through it (a MOSFET channel conducts both ways)${st.d1On ? '; its antiparallel diode D1 shares the current' : ''}. The switch node sits slightly above the bus voltage.`
            : 'Both gates are LOW (dead time). iL is negative, so the inductor forces the switch node up until D1 conducts into the bus.'
          : st.q2On
            ? pos
              ? `Q2 is gated ON and iL flows BACKWARDS through it, from ground into the switch node (synchronous rectification)${st.d2On ? '; D2 shares the current' : ''}.`
              : 'Q2 is gated ON and iL flows forward through it to ground: the inductor is connected across the battery.'
            : 'Both gates are LOW (dead time). iL is positive, so the inductor pulls the switch node down until D2 conducts from ground.',
    equation: `vsw = ${formatV(st.vsw)},  vL = vsw − vLV = ${formatV(st.vl)}`,
    physics: 'With complementary gating a switch is ON in every instant (except the dead time) and conducts in either direction, so iL may take any sign: there is no discontinuous mode — the current simply reverses.',
    whatIf: p.deadTime > 0 ? `During the dead time (${formatTime(p.deadTime)}) the DIRECTION of iL decides whether the switch node goes to the bus (D1) or to ground (D2): the effective duty depends on the current direction.` : 'With a dead time the antiparallel diodes would carry iL between the gate edges; try 0.25 µs under Advanced.',
  })
  // 2. The inductor current
  cards.push({
    id: 'il',
    question: `Why is iL ${st.dildt >= 0 ? 'rising' : 'falling'}?`,
    what: `iL = ${formatA(st.il, true)}, changing at ${formatSlopeA(st.dildt)}.`,
    why: st.vsw > st.vlv ? `The switch node is above the LV side: vL = ${formatV(st.vl)} > 0 pushes iL toward the battery.` : `The switch node is below the LV side: vL = ${formatV(st.vl)} < 0 pushes iL toward the bus.`,
    equation: `L·diL/dt = vsw − vLV − DCR·iL  ⇒  diL/dt = ${formatSlopeA(st.dildt)}`,
    physics: 'The inductor only sees the switch-node voltage (0 or VHV) against the battery side. Its AVERAGE current is set by how the average switch-node voltage D·VHV compares with the battery.',
    whatIf: `ΔiL = ${formatA(m.ilPP)} now; it does not depend on the current's direction (theory: VHV·D·(1 − D)/(L·fs)).`,
  })
  // 3. Power direction
  const buck = m.phvAvg >= 0
  cards.push({
    id: 'power',
    question: `Why does power flow ${buck ? 'from the bus to the battery' : 'from the battery to the bus'}?`,
    what: `Average bus power ${formatW(m.phvAvg)} (${buck ? 'out of' : 'into'} the bus), average battery current ${formatA(m.ibAvg, true)}.`,
    why: `The applied duty D = ${(p.d * 100).toFixed(2)} % makes the average switch-node voltage ${formatV(m.vswAvg, false)} ${m.vswAvg >= p.eb ? 'HIGHER' : 'LOWER'} than the battery EMF ${formatV(p.eb, false)}: the difference across Rb (+ DCR + Ron) drives the current ${buck ? 'into' : 'out of'} the battery.`,
    equation: `Ib = (D·VHV − Eb)/(Rb + DCR + Ron) (average model) · IHV = D·IL (power balance)`,
    physics: buck ? 'BUCK mode: the half-bridge steps the bus voltage down; energy flows from the high to the low side.' : 'BOOST mode: the same switches, the current reversed — the inductor charges from the battery while Q2 is ON and pushes its energy up into the bus while Q1 is ON.',
    whatIf: `A few percent of duty changes the current a lot: 1 % of D moves the average LV voltage by ${formatV(0.01 * p.vhv, false)}, which over ${formatSI(p.rb + p.rl + p.q.ron, 'Ω')} is ${formatA((0.01 * p.vhv) / (p.rb + p.rl + p.q.ron))}. This is why a real converter regulates the current in closed loop.`,
  })
  // 4. Gates
  cards.push({
    id: 'gate',
    question: 'Why are the gates complementary?',
    what: `Q1 ${st.g1 ? 'HIGH' : 'LOW'}, Q2 ${st.g2 ? 'HIGH' : 'LOW'} (${(st.phase * 100).toFixed(1)} % into the period).`,
    why: `Q1 and Q2 sit in series across the bus: both ON would short it. So exactly one is ON${p.deadTime > 0 ? `, with a dead time of ${formatTime(p.deadTime)} after each edge` : ''}. Q1 is ON for D·Ts = ${formatTime(p.d * p.ts)}.`,
    equation: `D = ${(p.d * 100).toFixed(2)} %${p.control === 'current' ? ` = (Eb + Iref·(Rb + DCR + Ron))/VHV (feed-forward for Iref = ${formatA(p.irefSigned, true)})` : ' (set by hand)'}`,
    physics: 'The duty is a COMMAND; the current that results is decided by the circuit (the simulation).',
    whatIf: `The reference asked for ${formatA(p.irefSigned, true)}; the simulation gives ${formatA(m.ibAvg, true)} (error ${formatA(m.irefError, true)}).`,
  })
  return cards
}

export function bidiEventLabel(e: RunEvent): string {
  const d = e.device ?? ''
  switch (e.kind) {
    case 'gate-on':
      return `${d} gate rises`
    case 'gate-off':
      return `${d} gate falls`
    case 'diode-on':
      return `${d} turns ON`
    case 'diode-off':
      return `${d} turns OFF`
    default:
      return `${d} ${e.kind}`
  }
}

export function bidiEventWhy(e: RunEvent): string {
  const v = e.values
  const il = v.il ?? 0
  switch (e.kind) {
    case 'gate-on':
      return `${e.device} is commanded ON; the switch node goes to ${formatV(v.vsw ?? 0)} with iL = ${formatA(il, true)}.`
    case 'gate-off':
      return `${e.device} is commanded OFF with iL = ${formatA(il, true)}: ${il > 0 ? 'a positive iL must find a path through the lower leg (D2 or Q2)' : il < 0 ? 'a negative iL must find a path through the upper leg (D1 or Q1)' : 'no current to hand over'}.`
    case 'diode-on':
      return `${e.device} is forward biased: it carries iL = ${formatA(il, true)} (the switch node is at ${formatV(v.vsw ?? 0)}).`
    case 'diode-off':
      return `${e.device} stops conducting: its current fell to zero or a switch took the current over.`
    default:
      return ''
  }
}

export function bidiNextConsequence(r: BidiRun, st: BidiState): NextConsequence | null {
  const k = converterIndexAt(r, st.t)
  const e = nextRunEvent(r, k, ['gate-on', 'gate-off', 'diode-off', 'diode-on'])
  if (!e) return null
  const at = `t = ${formatTime(e.time)}`
  if (e.kind === 'gate-off') return { text: `iL keeps ${st.dildt >= 0 ? 'rising' : 'falling'} at ${formatSlopeA(st.dildt)} until ${e.device} is turned OFF at ${at}.`, time: e.time }
  if (e.kind === 'gate-on') return { text: `${e.device} turns ON at ${at}; the switch node then follows that switch.`, time: e.time }
  return { text: `${e.device} changes state at ${at} (${e.kind === 'diode-on' ? 'it starts to conduct' : 'its current reaches zero'}).`, time: e.time }
}

export function bidiEnergy(st: BidiState, m: BidiMeasurements, r: BidiRun): EnergyModel {
  const p = r.params
  const ledger = [
    { id: 'bus', label: 'DC bus VHV', watts: -st.phv, note: '− = supplying, + = absorbing (boost)' },
    { id: 'sw', label: 'Switches Q1 + Q2', watts: st.vq1 * st.iq1 + st.vq2 * st.iq2, note: 'conduction loss' },
    { id: 'd', label: 'Diodes D1 + D2', watts: st.vd1 * st.id1 + st.vd2 * st.id2, note: 'conduction loss' },
    { id: 'l', label: 'Inductor L', watts: st.vl * st.il, note: 'vL·iL (+ storing, − releasing)' },
    { id: 'c', label: 'Capacitor C', watts: st.vc * st.ic, note: 'vC·iC' },
    { id: 'rl', label: 'DCR + ESR', watts: p.rl * st.il * st.il + p.esr * st.ic * st.ic, note: 'heat' },
    { id: 'rb', label: 'Battery resistance Rb', watts: st.prb, note: 'heat inside the battery' },
    { id: 'bat', label: 'Battery EMF Eb', watts: st.pbat, note: '+ = charging (stored), − = discharging' },
  ]
  return {
    ledger,
    stores: [
      { id: 'l', label: 'Inductor EL = ½·L·iL²', joules: st.el, fraction: st.el / Math.max(m.elMax, 1e-15), detail: `${st.vl * st.il >= 0 ? 'storing' : 'releasing'} ${formatW(Math.abs(st.vl * st.il))}` },
    ],
    balance: ledger.reduce((a, x) => a + x.watts, 0),
    tolerance: 1e-6 * Math.max(1e-12, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9,
    summary: `On average ${formatW(Math.abs(m.phvAvg))} ${m.phvAvg >= 0 ? 'leave the bus and' : 'reach the bus from the battery;'} ${m.phvAvg >= 0 ? `${formatW(m.pbatAvg)} is stored in the battery` : `the battery gives ${formatW(-m.pbatAvg)}`} (losses ${formatW(m.losses.total + m.prbAvg)}).`,
  }
}
