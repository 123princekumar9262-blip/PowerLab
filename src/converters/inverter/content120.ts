import type { CurrentPath, EnergyModel } from '../../workspace/contract.ts'
import type { Experiment, Lesson, PredictTask, Reading, StateView, StatusInfo, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import type { Meas120, Run120 } from './analysis120.ts'
import { START_DEG, type Inv120Params } from './conduction120.ts'
import { invStateAt, type InvState } from './content.ts'
import { BLEED, legDevices } from './model.ts'

/** How a leg is tied at an instant (from the simulated device states). */
export type LegTie = 'igbt-up' | 'igbt-down' | 'diode-up' | 'diode-down' | 'open'

export interface State120 extends InvState {
  /** Per leg: which device ties it to which rail, or open. */
  ties: LegTie[]
  /** Switches gated at the cursor (from the simulated gate traces). */
  gated: string[]
  vbn: number
  vcn: number
}

const PH = ['a', 'b', 'c'] as const

export function state120(r: Run120, k: number): State120 {
  const st = invStateAt(r as never, k)
  const names = legDevices(r.params)
  const ties: LegTie[] = st.legs.map((l, i) => {
    const [su, du, sl] = names[i]
    if (!l.conducting) return 'open'
    if (l.conducting === su) return 'igbt-up'
    if (l.conducting === du) return 'diode-up'
    if (l.conducting === sl) return 'igbt-down'
    return 'diode-down'
  })
  const gated = Object.keys(START_DEG).filter((id) => (r.devices.find((d) => d.id === id)?.gate?.[st.k] ?? 0) === 1)
  return { ...st, ties, gated, vbn: st.values.vbn ?? 0, vcn: st.values.vcn ?? 0 }
}

const tieText = (t: LegTie, dev: string | null) =>
  t === 'open' ? 'open — no device conducts' : t === 'igbt-up' ? `${dev} → + rail` : t === 'igbt-down' ? `${dev} → − rail` : t === 'diode-up' ? `${dev} (diode) → + rail` : `${dev} (diode) → − rail`

export function view120(st: State120, r: Run120): StateView {
  const p = r.params
  const rows: StateView['rows'] = [{ k: 't', v: `${formatTime(st.t)} · θ = ${st.theta.toFixed(1)}°`, full: true }, { k: 'gated', v: st.gated.join(' + ') || '—', full: true }]
  st.legs.forEach((l, i) => rows.push({ k: `Leg ${l.name}`, v: `${tieText(st.ties[i], l.conducting)} · ${formatV(l.v)}`, tone: st.ties[i] === 'open' ? 'off' : st.ties[i].startsWith('diode') ? 'on-d' : 'on-q', full: true }))
  rows.push(
    { k: 'van', v: formatV(st.van) },
    { k: 'vab', v: formatV(st.vo) },
    { k: 'ia', v: formatA(st.ia, true) },
    { k: 'ib', v: formatA(st.ib, true) },
    { k: 'ic', v: formatA(st.ic, true), min: 'standard' },
    { k: 'vnN (neutral)', v: formatV(st.vnN), min: 'standard' },
    { k: 'P from DC', v: formatW(st.pdc), tone: st.pdc < 0 ? 'on-d' : undefined, min: 'standard' },
    { k: 'conduction', v: `${p.conduction}° per switch`, min: 'engineer' },
  )
  const open = st.legs.filter((_l, i) => st.ties[i] === 'open').map((l) => l.name)
  const diode = st.legs.filter((_l, i) => st.ties[i].startsWith('diode')).map((l) => l.conducting)
  return {
    badge: diode.length ? { text: `${diode.join(', ')} freewheeling`, tone: 'off' } : open.length ? { text: `Leg ${open.join(', ')} floats`, tone: 'neutral' } : { text: 'All three legs tied to a rail', tone: 'on' },
    rows,
    path: path120(st).text,
  }
}

export function status120(st: State120): StatusInfo {
  const open = st.legs.filter((_l, i) => st.ties[i] === 'open')
  const names = legDevices({ topology: 'three' })
  const diode = st.legs.filter((_l, i) => st.ties[i].startsWith('diode') && !st.gated.some((g) => names[i].includes(g)))
  const facts = [`van = ${formatV(st.van)}`, `vab = ${formatV(st.vo)}`]
  if (open.length) return { headline: `${st.gated.join(' + ')} gated · leg ${open.map((l) => l.name).join(', ')} floats`, facts: [...facts, `v${open[0].name.toLowerCase()}N = ${formatV(open[0].v)} (the neutral)`], tone: 'neutral' }
  if (diode.length) return { headline: `${st.gated.join(' + ')} gated · ${diode.map((l) => l.conducting).join(', ')} freewheels`, facts: [...facts, `leg ${diode[0].name} has no gate but carries ${formatA(diode[0].i, true)}`], tone: 'off' }
  return { headline: `${st.gated.join(' + ')} gated · all legs tied`, facts, tone: 'on' }
}

/** The conducting loop(s) at the cursor, from the simulated device states and current signs. */
export function path120(st: State120): CurrentPath {
  const outs: string[] = []
  const ins: string[] = []
  const els: string[] = []
  st.legs.forEach((l, i) => {
    if (!l.conducting) return
    els.push(l.conducting, `load-${PH[i]}`)
    // current out of the leg into the load (i > 0) comes from the device; into the leg (i < 0) goes to it
    if (l.i > 0) outs.push(`${l.conducting} → ${PH[i]}`)
    else ins.push(`${PH[i]} → ${l.conducting}`)
  })
  const text = outs.length && ins.length ? `${outs.join(' + ')} → n → ${ins.join(' + ')}` : 'no current flows'
  const reasons = st.legs.filter((_l, i) => st.ties[i].startsWith('diode')).map((l) => `${l.conducting} carries leg ${l.name}'s current (${formatA(l.i, true)}) although its switch is not conducting`)
  return { elements: els, text, reasons }
}

/** Power at the cursor: source, load resistors, inductors, devices and bleed resistors (from the simulated sample). */
export function energy120(st: State120, r: Run120): EnergyModel {
  const p = r.params
  const v = st.values
  const ii = [v.ia, v.ib, v.ic]
  const vph = [v.van, v.vbn, v.vcn]
  const pR = ii.reduce((s, x) => s + p.r * x * x, 0)
  const pL = p.load === 'RL' ? ii.reduce((s, x, k) => s + (vph[k] - p.r * x) * x, 0) : 0
  let pDev = 0
  for (const d of r.devices) pDev += d.voltage[st.k] * d.current[st.k]
  const pBleed = ['vaN', 'vbN', 'vcN'].reduce((s, k) => s + (v[k] * v[k]) / BLEED, 0)
  const ledger = [
    { id: 'src', label: 'DC source', watts: -v.pdc, note: v.pdc >= 0 ? 'supplies energy' : 'absorbs energy returned through the diodes' },
    { id: 'r', label: 'Load resistors', watts: pR, note: 'R·(ia² + ib² + ic²) as heat' },
    ...(p.load === 'RL' ? [{ id: 'l', label: 'Load inductors', watts: pL, note: 'Σ vL·i: + storing, − releasing' }] : []),
    { id: 'dev', label: 'IGBTs and diodes', watts: pDev, note: 'conduction loss v·i' },
    { id: 'bleed', label: 'Bleed resistors', watts: pBleed, note: '1 MΩ voltage-sensing resistors' },
  ]
  let eMax = 0
  if (p.load === 'RL') for (const k of ['ia', 'ib', 'ic']) for (let j = r.steadyFrom; j < r.length; j++) eMax = Math.max(eMax, 0.5 * p.l * r.signals[k][j] ** 2)
  const stores =
    p.load === 'RL'
      ? PH.map((ph, k) => {
          const e = 0.5 * p.l * ii[k] * ii[k]
          const pk = (vph[k] - p.r * ii[k]) * ii[k]
          return { id: `l${ph}`, label: `Inductor ${ph}: ½·L·i${ph}²`, joules: e, fraction: e / Math.max(eMax, 1e-15), detail: `${pk >= 0 ? 'storing' : 'releasing'} ${formatW(Math.abs(pk))}` }
        })
      : []
  return { ledger, stores, balance: ledger.reduce((a, x) => a + x.watts, 0), tolerance: 1e-6 * Math.max(1e-9, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9 }
}

export function why120(r: Run120, st: State120, m: Meas120): WhyCard[] {
  const p = r.params
  const V = p.vdc
  const cards: WhyCard[] = []
  const nGated = st.gated.length
  cards.push({
    id: 'pair',
    question: p.conduction === 120 ? `Why are only ${st.gated.join(' and ')} gated?` : `Why are ${st.gated.join(', ')} gated?`,
    what: `θ = ${st.theta.toFixed(1)}°: ${nGated} switches are gated (SIMULATION gate traces).`,
    why:
      p.conduction === 120
        ? 'Each switch is gated for 120°, and the next one in the order S1 … S6 starts every 60°. So two are always gated: one upper switch and one lower switch, in two different legs. The third leg has no gate at all.'
        : 'Each switch is gated for 180° (six-step): every leg always has either its upper or its lower switch gated, so three switches are gated at any time.',
    equation: `S1 0°, S2 60°, S3 120°, S4 180°, S5 240°, S6 300° — each for ${p.conduction}°`,
    physics:
      p.conduction === 120
        ? 'The upper and lower switch of one leg are gated 60° apart, so they can never short the DC supply, even if a switch is slow to turn off: a built-in safety margin.'
        : 'Upper and lower switch of a leg are handed over at the same instant: a real six-step inverter needs a dead time there.',
    whatIf: p.conduction === 120 ? 'With 180° conduction every leg would always be tied to a rail and the phase voltage would be the six-step staircase (±Vdc/3, ±2Vdc/3).' : 'With 120° conduction one leg would have no gate for each 60° interval.',
  })
  const iFree = st.legs.findIndex((_l, i) => !st.gated.some((g) => legDevices(p)[i].includes(g)))
  if (iFree >= 0) {
    const l = st.legs[iFree]
    const tie = st.ties[iFree]
    if (tie === 'open')
      cards.push({
        id: 'float',
        question: `Why does leg ${l.name} sit at ${formatV(l.v, false)}?`,
        what: `Leg ${l.name} has no gate and its current is ${formatA(l.i, true)}: no device conducts, the leg floats.`,
        why: `With no current in phase ${PH[iFree]}, there is no voltage across its R${p.load === 'RL' ? '-L' : ''}: the leg node sits at the load neutral, halfway between the two connected legs.`,
        equation: `v${PH[iFree]}N = vnN = (v₁ + v₂)/2 = ${formatV(st.vnN)},  v${PH[iFree]}n = 0`,
        physics: 'Only two phases carry current: the load is a series path R + R (+ L + L) across Vdc, so each connected phase gets ±Vdc/2.',
        whatIf: p.load === 'R' ? 'With an R-L load the current cannot stop at once when the switch turns off: a diode carries it first (try Load → R-L).' : 'A larger L makes the current take longer to die, so the leg floats for a shorter part of its 60°.',
      })
    else
      cards.push({
        id: 'diode',
        question: `Why does ${l.conducting} conduct although leg ${l.name} has no gate?`,
        what: `Leg ${l.name}'s switch was released, but phase ${PH[iFree]} still carries ${formatA(l.i, true)}.`,
        why: `The inductance keeps the current flowing. It can only pass through the freewheeling diode ${l.conducting}, which ties leg ${l.name} to the ${tie === 'diode-up' ? 'upper' : 'lower'} rail (${formatV(l.v)}) — the modulator does not decide this voltage, the current does.`,
        equation: `L·di/dt = v${PH[iFree]}n − R·i${PH[iFree]}: the current decays towards ${formatA((st.values[`v${PH[iFree]}n`] ?? 0) / p.r, true)} and the diode stops at i = 0`,
        physics: 'While all three legs are tied, the neutral sits at the average of the three leg voltages, as in six-step operation: van takes ±Vdc/3, ±2Vdc/3 instead of ±Vdc/2.',
        whatIf: `If L were large enough the current would never reach zero within 60°: the waveform would become six-step (SIMULATION here: diodes ${(m.diodeFraction * 100).toFixed(1)} %, legs open ${(m.floatFraction * 100).toFixed(1)} % of the cycle, Σ over legs).`,
      })
  }
  cards.push({
    id: 'van',
    question: `Why is van = ${formatV(st.van)} now?`,
    what: `Leg voltages vaN ${formatV(st.legs[0].v)}, vbN ${formatV(st.legs[1].v)}, vcN ${formatV(st.legs[2].v)}; the load neutral is at vnN = ${formatV(st.vnN)}.`,
    why: st.ties.includes('open') ? 'With one leg open the neutral sits halfway between the two connected legs: the connected phases get ±Vdc/2, the open one 0.' : 'All three legs are tied to rails: the neutral sits at their average, so the phases get ±Vdc/3 or ±2Vdc/3.',
    equation: `van = vaN − vnN = ${formatV(st.legs[0].v)} − ${formatV(st.vnN)} = ${formatV(st.van)}`,
    physics: `Over the cycle: fundamental ${formatV(m.vph1, false)} peak (SIMULATION)${p.conduction === 120 ? `; THEORY for an R load √3·Vdc/π = ${formatV((Math.sqrt(3) * V) / Math.PI, false)}` : `; THEORY 2·Vdc/π = ${formatV((2 * V) / Math.PI, false)}`}.`,
    whatIf: p.conduction === 120 ? `180° conduction would raise it to 2·Vdc/π = ${formatV((2 * V) / Math.PI, false)}.` : `120° conduction (R load) would give √3·Vdc/π = ${formatV((Math.sqrt(3) * V) / Math.PI, false)}.`,
  })
  cards.push({
    id: 'line',
    question: `Why is vab = ${formatV(st.vo)}?`,
    what: `vab = vaN − vbN = ${formatV(st.legs[0].v)} − ${formatV(st.legs[1].v)}.`,
    why: p.conduction === 120 ? 'When both legs a and b are tied to opposite rails vab = ±Vdc; when one of them floats at the neutral (Vdc/2) vab = ±Vdc/2. With an R load that gives steps of Vdc/2 and Vdc, 60° each.' : 'Each leg is always on a rail, so vab is +Vdc, 0 or −Vdc: a quasi-square wave with 60° zero intervals.',
    equation: p.conduction === 120 ? 'VLL1 = 3·Vdc/π (R load),  VLL,rms = Vdc/√2' : 'VLL1 = 2√3·Vdc/π,  VLL,rms = √(2/3)·Vdc',
    physics: `SIMULATION: VLL1 = ${formatV(m.v1, false)} peak, RMS ${formatV(m.vrms, false)}. Only harmonics 6k ± 1 (5th ${formatV(m.v5, false)}, 7th ${formatV(m.v7, false)}): triplens are equal in all phases and cancel.`,
    whatIf: 'The line voltage is √3 times the phase voltage for every harmonic that is present.',
  })
  if (p.load === 'RL')
    cards.push({
      id: 'lag',
      question: 'Why does the current lag the voltage?',
      what: `The current fundamental lags the phase-voltage fundamental by atan(ωL/R) = ${((Math.atan((p.omega * p.l) / p.r) * 180) / Math.PI).toFixed(1)}°.`,
      why: 'The inductor resists changes of current: after each step of the phase voltage the current approaches its new value with τ = L/R.',
      equation: `I1 = Vph1/|R + jωL| = ${formatV(m.vph1, false)}/${formatSI(Math.hypot(p.r, p.omega * p.l), 'Ω')} = ${formatA(m.i1)}`,
      physics: `That lag is what makes the released leg's current outlive its gate (τ = ${formatTime(p.l / p.r)}).`,
      whatIf: 'With a purely resistive load the current follows the voltage instantly and no diode ever conducts.',
    })
  return cards
}

export function eventLabel120(e: RunEvent): string {
  const d = e.device ?? ''
  switch (e.kind) {
    case 'gate-on':
      return `${d} gated (leg ${legOf(d)})`
    case 'gate-off':
      return `${d} released`
    case 'igbt-on':
      return `${d} starts conducting`
    case 'igbt-off':
      return `${d} stops conducting`
    case 'diode-on':
      return `${d} starts conducting (freewheeling)`
    case 'diode-off':
      return `${d} stops: leg ${legOf(d)} current reaches zero`
    default:
      return e.kind
  }
}
export function eventWhy120(e: RunEvent): string {
  const d = e.device ?? ''
  switch (e.kind) {
    case 'gate-on':
      return `The firing sequence gates ${d} (one switch every 60°). Leg ${legOf(d)} is tied to the ${['S1', 'S3', 'S5'].includes(d) ? 'upper' : 'lower'} rail from now on.`
    case 'gate-off':
      return `${d} has been gated for its conduction angle. Leg ${legOf(d)} now has no gate: its voltage is set by its current.`
    case 'diode-on':
      return `Leg ${legOf(d)}'s current keeps flowing after its switch was released: ${d} carries it and ties the leg to a rail.`
    case 'diode-off':
      return `The current through ${d} has decayed to zero; a diode cannot carry it the other way, so leg ${legOf(d)} is open and floats at the neutral.`
    case 'igbt-on':
      return `${d} is gated and its current flows forward.`
    case 'igbt-off':
      return `${d} lost its gate (or its current reversed).`
    default:
      return ''
  }
}
const legOf = (d: string) => (['S1', 'S4', 'D1', 'D4'].includes(d) ? 'A' : ['S3', 'S6', 'D3', 'D6'].includes(d) ? 'B' : 'C')

/** A value and its unit (with SI prefix) for the readings strip. */
const si = (x: number, unit: string) => {
  const [value, u] = formatSI(x, unit).split(' ')
  return { value, unit: u }
}

export function readings120(m: Meas120, r: Run120): Reading[] {
  const p = r.params
  const per = (m.floatFraction / 3) * 360
  return [
    { id: 'v1', label: 'Line voltage, fundamental peak', ...si(m.v1, 'V'), note: p.conduction === 120 ? 'R load: 3·Vdc/π' : '2√3·Vdc/π' },
    { id: 'vph1', label: 'Phase voltage, fundamental peak', ...si(m.vph1, 'V'), note: p.conduction === 120 ? 'R load: √3·Vdc/π' : '2·Vdc/π' },
    { id: 'irms', label: 'Phase current, RMS', ...si(m.irms, 'A'), note: 'I1 = Vph1/|R + jωL|' },
    { id: 'float', label: 'Each leg floats', value: per.toFixed(1), unit: '° per cycle', note: p.conduction === 120 ? (p.load === 'R' ? '2 × 60° with an R load' : 'less than 2 × 60°: the diodes clamp it first') : 'never (180°)', min: 'standard' },
  ]
}

/** Time of angle θ [deg] in the shown run (second cycle when two are shown). */
const at = (r: Run120, deg: number) => r.params.period * ((r.params.periods > 1 ? 1 : 0) + deg / 360)
const twoCycles = (r: Run120): [number, number] => [r.params.periods > 1 ? r.params.period : 0, r.params.periods > 1 ? 2 * r.params.period : r.params.period]
/** The first diode turn-off after angle θ (the released leg's current reaching zero), else θ + 30°. */
const afterDiodeOff = (r: Run120, deg: number) => {
  const t0 = at(r, deg)
  const e = r.events.find((x) => x.kind === 'diode-off' && x.time > t0 && x.time < t0 + r.params.period / 6)
  return e ? e.time + 3 * r.params.dt : at(r, deg + 30)
}

export const LESSONS_120: Array<Lesson<Inv120Params, Run120, Meas120, State120>> = [
  {
    id: 'two',
    title: 'Two switches at a time',
    summary: 'Each switch conducts for 120°: one leg is always left without a gate.',
    check: {
      question: 'In 120° conduction with an R load, which levels does the phase voltage van take?',
      options: ['+Vdc/2, 0 and −Vdc/2', '±Vdc/3 and ±2Vdc/3', '+Vdc and 0 only'],
      answer: 0,
      explain: 'Two phases carry the current in series across Vdc, so each gets ±Vdc/2; the open phase carries none, so its voltage is 0. Each phase is at ±Vdc/2 for 120° and at 0 for 60° per half cycle.',
    },
    base: { conduction: 120, load: 'R' },
    steps: [
      {
        title: 'One switch every 60°, each for 120°',
        at: (r) => at(r, 30),
        window: twoCycles,
        channels: ['vaN', 'vbN', 'vcN'],
        look: 'Legs A and B are on opposite rails; leg C sits in the middle.',
        body: (st) => `At θ = ${st.theta.toFixed(0)}° the gated switches are ${st.gated.join(' and ')} (SIMULATION gate traces): one upper, one lower, in two different legs. Every 60° the next switch in the order S1 … S6 is gated and the oldest one released.`,
      },
      {
        title: 'The third leg floats',
        at: (r) => at(r, 30),
        window: twoCycles,
        channels: ['vcN', 'vnN', 'ic'],
        look: 'vcN equals the neutral voltage vnN; ic is zero.',
        body: (st) => `Leg C has no gate and its current is ${formatA(st.ic, true)}: no device conducts. It sits at the load neutral, vcN = ${formatV(st.legs[2].v)} = vnN = ${formatV(st.vnN)} — halfway between the two connected legs.`,
      },
      {
        title: 'Phase voltage: ±Vdc/2 or 0',
        at: (r) => at(r, 30),
        window: twoCycles,
        channels: ['van', 'ia'],
        look: 'van is +Vdc/2 for 120°, 0 for 60°, −Vdc/2 for 120°, 0 for 60°.',
        body: (st, m, r) => `Phases a and b form one series path across Vdc: van = ${formatV(st.van)} = +Vdc/2. SIMULATION over the cycle: fundamental ${formatV(m.vph1, false)} peak (THEORY √3·Vdc/π = ${formatV((Math.sqrt(3) * r.params.vdc) / Math.PI, false)}), RMS ${formatV(m.vphRms, false)} (Vdc/√6 = ${formatV(r.params.vdc / Math.sqrt(6), false)}).`,
      },
      {
        title: 'Line voltage: steps of Vdc/2 and Vdc',
        at: (r) => at(r, 90),
        window: twoCycles,
        channels: ['vab', 'vbc'],
        look: 'vab: Vdc/2, Vdc, Vdc/2 in each half cycle.',
        body: (st, m, r) => `vab = vaN − vbN = ${formatV(st.vo)} now. It is ±Vdc when legs a and b are tied to opposite rails and ±Vdc/2 when one of them floats. SIMULATION: VLL1 = ${formatV(m.v1, false)} peak (THEORY 3·Vdc/π = ${formatV((3 * r.params.vdc) / Math.PI, false)}), RMS ${formatV(m.vrms, false)} (Vdc/√2).`,
      },
    ],
  },
  {
    id: 'rl',
    title: 'Inductive load: the floating leg is not free',
    summary: 'After each commutation a diode carries the released current and clamps the leg to a rail.',
    check: {
      question: 'Right after a switch of a 120° inverter with an R-L load is released, its phase current…',
      options: ['stops at once', 'keeps flowing through the opposite diode of that leg until it decays to zero', 'reverses at once'],
      answer: 1,
      explain: 'The inductance keeps the current flowing; the only path is the freewheeling diode on the other side of the leg. It ties the leg to that rail until the current reaches zero — only then does the leg float.',
    },
    base: { conduction: 120, load: 'RL', l: 20e-3 },
    steps: [
      {
        title: 'S6 is released, ib keeps flowing',
        at: (r) => at(r, 62),
        window: twoCycles,
        channels: ['vbN', 'ib', 'iD3'],
        look: 'At 60° S6 turns off, but ib is still negative: D3 conducts.',
        body: (st) => {
          const b = st.legs[1]
          return `Leg B lost its gate at 60°, yet ib = ${formatA(st.ib, true)}. ${b.conducting ? `${b.conducting} carries it, so leg B sits at ${formatV(b.v)} — the ${b.v > 0 ? 'upper' : 'lower'} rail, not the neutral.` : 'No device conducts any more: the current has already died.'}`
        },
      },
      {
        title: 'Until the current reaches zero',
        at: (r) => afterDiodeOff(r, 60),
        window: twoCycles,
        channels: ['vbN', 'vnN', 'ib'],
        look: 'When ib reaches zero the diode stops; vbN drops to the neutral.',
        body: (st, _m, r) => {
          const e = r.events.find((x) => x.kind === 'diode-off' && x.time > at(r, 60) && x.time < at(r, 120))
          return e ? `The diode ${e.device} stopped at θ = ${(((e.time / r.params.period) % 1) * 360).toFixed(1)}°, when ib reached zero (SIMULATION event). From then on leg B floats: vbN = ${formatV(st.legs[1].v)} = vnN.` : `ib did not reach zero within this 60° interval: leg B stays clamped to a rail (vbN = ${formatV(st.legs[1].v)}).`
        },
      },
      {
        title: 'The phase voltage leaves the staircase',
        at: (r) => at(r, 62),
        window: twoCycles,
        channels: ['van', 'vbn', 'ia'],
        look: 'Extra steps of Vdc/3 and 2Vdc/3 appear while a diode conducts.',
        body: (_st, m, r) => `While a diode clamps the third leg all three legs are tied, and the phases see ±Vdc/3, ±2Vdc/3 as in six-step. SIMULATION: Vph1 = ${formatV(m.vph1, false)} (R-load staircase: ${formatV((Math.sqrt(3) * r.params.vdc) / Math.PI, false)}); diodes conduct ${(m.diodeFraction * 100).toFixed(1)} % and legs are open ${(m.floatFraction * 100).toFixed(1)} % of the cycle (Σ legs).`,
      },
      {
        title: 'Very inductive: back to six-step',
        params: { l: 0.1 },
        at: (r) => at(r, 62),
        window: twoCycles,
        channels: ['van', 'ia'],
        look: 'With L = 100 mH no leg ever floats.',
        body: (_st, m, r) => `τ = L/R = ${formatTime(r.params.l / r.params.r)}: the released current never dies within 60°, so every leg is always clamped. Legs open: ${(m.floatFraction * 100).toFixed(2)} % of the cycle. Vph1 = ${formatV(m.vph1, false)}, the six-step value 2·Vdc/π = ${formatV((2 * r.params.vdc) / Math.PI, false)}: the gates no longer decide the waveform.`,
      },
    ],
  },
  {
    id: 'vs180',
    title: '120° or 180°?',
    summary: 'Six-step gives more voltage; 120° keeps a safe gap between the two switches of a leg.',
    check: {
      question: 'Same Vdc and R load: switching from 120° to 180° conduction makes the fundamental line voltage…',
      options: ['about 15 % larger (×2/√3)', 'unchanged', 'about 15 % smaller'],
      answer: 0,
      explain: 'VLL1 = 3·Vdc/π with 120° and 2√3·Vdc/π with 180°: the ratio is 2/√3 = 1.155.',
    },
    base: { conduction: 120, load: 'R' },
    steps: [
      {
        title: '120°: two legs drive the load',
        at: (r) => at(r, 30),
        window: twoCycles,
        channels: ['van', 'vab'],
        look: 'van: ±Vdc/2 and 0.',
        body: (_st, m) => `SIMULATION: VLL1 = ${formatV(m.v1, false)} peak, phase fundamental ${formatV(m.vph1, false)}. S1 conducts ${(m.s1Frac * 100).toFixed(1)} % of the cycle.`,
      },
      {
        title: '180°: all three legs, six steps',
        params: { conduction: 180 },
        at: (r) => at(r, 30),
        window: twoCycles,
        channels: ['van', 'vab'],
        look: 'van: ±Vdc/3 and ±2Vdc/3 — no zero level.',
        body: (st, m, r) => `Now ${st.gated.join(', ')} are gated: every leg is on a rail. SIMULATION: VLL1 = ${formatV(m.v1, false)} (THEORY 2√3·Vdc/π = ${formatV((2 * Math.sqrt(3) * r.params.vdc) / Math.PI, false)}), phase fundamental ${formatV(m.vph1, false)}. S1 conducts ${(m.s1Frac * 100).toFixed(1)} % of the cycle.`,
      },
      {
        title: 'What 120° buys',
        at: (r) => at(r, 30),
        window: twoCycles,
        channels: ['vaN', 'van'],
        look: 'Between S1 and S4 of leg A there are 60° with neither gated.',
        body: (_st, m) => `120°: less voltage (VLL1 ${formatV(m.v1, false)}, ×√3/2 of six-step) and, with an inductive load, a waveform that depends on the load. In return the upper and lower switch of a leg are never handed over at the same instant — 60° pass between them, a large safety gap against a short circuit of the DC supply — and each switch conducts only a third of the cycle.`,
      },
    ],
  },
]

export const EXPERIMENTS_120: Array<Experiment<Inv120Params, Meas120>> = [
  {
    id: 'six',
    title: '120° → 180° conduction',
    change: () => ({ conduction: 180 }),
    question: () => 'Same Vdc, same R load: switch every switch from 120° to 180° conduction. What happens to the fundamental line voltage VLL1?',
    choices: ['It rises by about 15 % (×2/√3)', 'It stays the same', 'It falls'],
    judge: (b, a) => {
      const q = a.v1 / b.v1
      return Math.abs(q - 2 / Math.sqrt(3)) < 0.02 ? 0 : Math.abs(q - 1) < 0.02 ? 1 : 2
    },
    rows: ['v1', 'vph1', 'vrms', 'floatFraction', 's1Frac'],
    why: (b, a) => `VLL1 ${formatV(b.v1, false)} → ${formatV(a.v1, false)} (×${(a.v1 / b.v1).toFixed(3)}; 2/√3 = 1.155). With 180° no leg is ever open (open time ${(b.floatFraction * 100).toFixed(1)} % → ${(a.floatFraction * 100).toFixed(1)} %, Σ legs), so the phases get ±Vdc/3, ±2Vdc/3 instead of ±Vdc/2 and 0: more volt-seconds per cycle. Each switch now conducts ${(a.s1Frac * 100).toFixed(1)} % instead of ${(b.s1Frac * 100).toFixed(1)} % of the cycle.`,
  },
  {
    id: 'rl',
    title: 'Make the load inductive',
    change: () => ({ load: 'RL', l: 20e-3 }),
    question: () => 'The R load gets a series inductance of 20 mH. Does each leg still float for its full 2 × 60° per cycle?',
    choices: ['No — the freewheeling diodes clamp it for part of that time', 'Yes, exactly as with R', 'It floats for longer'],
    judge: (b, a) => (a.floatFraction < b.floatFraction - 0.01 ? 0 : Math.abs(a.floatFraction - b.floatFraction) <= 0.01 ? 1 : 2),
    rows: ['floatFraction', 'diodeFraction', 'vph1', 'thdPh'],
    why: (b, a) => `Legs open ${(b.floatFraction * 100).toFixed(1)} % → ${(a.floatFraction * 100).toFixed(1)} % of the cycle (Σ legs); diodes ${(b.diodeFraction * 100).toFixed(1)} % → ${(a.diodeFraction * 100).toFixed(1)} %. When a switch is released its inductive current continues through the opposite diode, which ties the leg to a rail until the current dies. The phase voltage is no longer the textbook staircase (THD ${(b.thdPh * 100).toFixed(1)} % → ${(a.thdPh * 100).toFixed(1)} %).`,
  },
  {
    id: 'bigL',
    title: 'A very inductive load',
    change: () => ({ load: 'RL', l: 0.1 }),
    question: () => 'The load becomes strongly inductive (R-L with L = 100 mH, τ = 10 ms). What happens to the phase-voltage fundamental?',
    choices: ['It rises towards the six-step value 2·Vdc/π', 'It stays at √3·Vdc/π', 'It falls'],
    judge: (b, a) => (a.vph1 > 1.02 * b.vph1 ? 0 : Math.abs(a.vph1 / b.vph1 - 1) <= 0.02 ? 1 : 2),
    rows: ['vph1', 'floatFraction', 'diodeFraction', 'irms'],
    why: (b, a) => `Vph1 ${formatV(b.vph1, false)} → ${formatV(a.vph1, false)}. The released current takes longer than 60° to die, so a diode keeps every "floating" leg on a rail (open ${(a.floatFraction * 100).toFixed(2)} % of the cycle): the inverter behaves like six-step whatever the gates say. 120° conduction only gives its textbook waveform with a load that lets the current stop quickly.`,
  },
]

export function predictions120(seed: number): Array<PredictTask<Inv120Params, Meas120>> {
  const vdc = [100, 200, 300, 600][seed % 4]
  const vdc2 = [150, 250, 400][seed % 3]
  return [
    {
      id: 'vph1',
      prompt: `120° conduction, R load, Vdc = ${vdc} V. Predict the peak fundamental of the phase voltage van.`,
      params: { conduction: 120, load: 'R', vdc },
      kind: 'number',
      unit: 'V',
      answer: (x) => x.vph1,
      tolerance: 0.02,
      hint: 'van is a quasi-square wave of height Vdc/2, 120° wide.',
      theory: (p) => `Vph1 = (4/π)·(Vdc/2)·cos 30° = √3·Vdc/π = ${formatV((Math.sqrt(3) * p.vdc) / Math.PI, false)}`,
    },
    {
      id: 'vll1',
      prompt: `120° conduction, R load, Vdc = ${vdc2} V. Predict the peak fundamental of the line voltage vab.`,
      params: { conduction: 120, load: 'R', vdc: vdc2 },
      kind: 'number',
      unit: 'V',
      answer: (x) => x.v1,
      tolerance: 0.02,
      hint: 'The line voltage is √3 times the phase voltage.',
      theory: (p) => `VLL1 = √3·(√3·Vdc/π) = 3·Vdc/π = ${formatV((3 * p.vdc) / Math.PI, false)}`,
    },
    {
      id: 'vphrms',
      prompt: `120° conduction, R load, Vdc = ${vdc} V. Predict the RMS of the phase voltage van.`,
      params: { conduction: 120, load: 'R', vdc },
      kind: 'number',
      unit: 'V',
      answer: (x) => x.vphRms,
      tolerance: 0.02,
      hint: 'van = ±Vdc/2 for 2 × 120° per cycle, 0 otherwise.',
      theory: (p) => `Vph,rms = (Vdc/2)·√(240°/360°) = Vdc/√6 = ${formatV(p.vdc / Math.sqrt(6), false)}`,
    },
    {
      id: 'count',
      prompt: '120° conduction, R load: how many devices conduct at any instant?',
      params: { conduction: 120, load: 'R' },
      kind: 'choice',
      choices: ['1', '2', '3'],
      answer: (x) => Math.max(0, Math.min(2, x.maxConducting - 1)),
      hint: 'Each switch is gated 120°, one starts every 60°.',
      theory: () => 'Two switches (one upper, one lower, different legs); the third leg carries no current with an R load.',
    },
  ]
}

