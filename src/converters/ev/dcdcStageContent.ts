import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { reading } from '../../lab/readings.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { CurrentPath, EnergyModel, StatusInfo } from '../../workspace/contract.ts'
import type { RunEvent } from '../types.ts'
import { measureStage, resolveStage, simulateStage, STAGE_DEFAULTS, type StageMeasurements, type StageParams, type StageRun } from './dcdcStage.ts'
import { exactDuty, stageExact, stageTextbook, type StageExact } from './dcdcStageTheory.ts'

export { measureStage, simulateStage, STAGE_DEFAULTS }

const pct = (x: number, d = 2) => `${(100 * x).toFixed(d)} %`
const kw = (w: number) => `${(w / 1000).toFixed(1)} kW`

// ── STATE AT THE CURSOR ───────────────────────────────────────────────────────────────────────────────

export type StageInterval = 'S2 on' | 'S1 on' | 'dead time'
export interface StageState {
  k: number
  t: number
  /** Position in the switching period (0…1). */
  phase: number
  g1: boolean
  g2: boolean
  s1: boolean
  s2: boolean
  d1: boolean
  d2: boolean
  il: number
  dildt: number
  vsw: number
  vlink: number
  vc: number
  ic: number
  iinv: number
  vbt: number
  is1: number
  is2: number
  id1: number
  id2: number
  interval: StageInterval
  /** Which way energy goes on average in this run. */
  regen: boolean
  /** The devices carrying iL now. */
  carriers: string[]
}

export function stageStateAt(r: StageRun, k: number): StageState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const dev = (id: string) => r.devices.find((d) => d.id === id)!
  const on = (id: string) => dev(id).on[i] === 1
  const g1 = (dev('S1').gate?.[i] ?? 0) === 1
  const g2 = (dev('S2').gate?.[i] ?? 0) === 1
  const t = r.time[i]
  const il = s.il[i]
  const vl = p.vbat - (p.rbat + p.rl) * il - s.vsw[i]
  const carriers: string[] = []
  const add = (id: string, cur: number) => {
    if (on(id) && Math.abs(cur) > 1e-6) carriers.push(id)
  }
  add('S2', s.is2[i])
  add('D2', s.id2[i])
  add('S1', s.is1[i])
  add('D1', s.id1[i])
  return {
    k: i,
    t,
    phase: (t / p.ts) % 1,
    g1,
    g2,
    s1: on('S1'),
    s2: on('S2'),
    d1: on('D1'),
    d2: on('D2'),
    il,
    dildt: vl / p.l,
    vsw: s.vsw[i],
    vlink: s.vlink[i],
    vc: s.vc[i],
    ic: s.ic[i],
    iinv: s.iinv[i],
    vbt: s.vbt[i],
    is1: s.is1[i],
    is2: s.is2[i],
    id1: s.id1[i],
    id2: s.id2[i],
    interval: g2 ? 'S2 on' : g1 ? 'S1 on' : 'dead time',
    regen: p.power < 0,
    carriers,
  }
}

const slope = (x: number) => `${x >= 0 ? '+' : '−'}${formatSI(Math.abs(x), 'A/s')}`

export function stageView(st: StageState): StateView {
  return {
    badge: { text: st.interval === 'dead time' ? `dead time · ${st.carriers.join(' ') || 'no current'}` : st.interval, tone: st.interval === 'dead time' ? 'idle' : 'on' },
    rows: [
      { k: 't', v: `${formatTime(st.t)} (${(st.phase * 100).toFixed(1)} % of Ts)`, full: true },
      { k: 'S1 (high side)', v: st.s1 ? 'ON' : 'OFF', tone: st.s1 ? 'on-q' : 'off' },
      { k: 'S2 (low side)', v: st.s2 ? 'ON' : 'OFF', tone: st.s2 ? 'on-q' : 'off' },
      { k: 'D1', v: st.d1 ? 'ON' : 'OFF', tone: st.d1 ? 'on-d' : 'off', min: 'standard' },
      { k: 'D2', v: st.d2 ? 'ON' : 'OFF', tone: st.d2 ? 'on-d' : 'off', min: 'standard' },
      { k: 'iL (battery current)', v: `${formatA(st.il, true)} · ${slope(st.dildt)}`, full: true },
      { k: 'Vlink', v: formatV(st.vlink, false) },
      { k: 'Vbattery (terminals)', v: formatV(st.vbt, false) },
      { k: 'switch node', v: formatV(st.vsw, false), min: 'standard' },
      { k: 'inverter current', v: formatA(st.iinv, true), min: 'standard' },
      { k: 'iC', v: formatA(st.ic, true), min: 'engineer' },
      { k: 'iS1 / iS2', v: `${formatA(st.is1, true)} / ${formatA(st.is2, true)}`, min: 'engineer', full: true },
    ],
    path: stagePathText(st),
  }
}

function stagePathText(st: StageState): string {
  const via = st.carriers.length ? st.carriers.join(' + ') : '—'
  const lo = st.carriers.some((c) => c === 'S2' || c === 'D2')
  if (st.il >= 0) return lo ? `battery + → L → ${via} → battery − (the inductor stores energy)` : `battery + → L → ${via} → DC link (C and inverter) → battery −`
  return lo ? `battery − → ${via} → L → battery + (the inductor gives energy to the battery)` : `DC link → ${via} → L → battery + (energy from the link)`
}
export function stagePath(st: StageState): CurrentPath {
  const lo = st.carriers.some((c) => c === 'S2' || c === 'D2')
  const els = ['battery', 'l', ...st.carriers.map((c) => c.toLowerCase()), ...(lo ? [] : ['c', 'inv'])]
  const reasons = [
    st.interval === 'dead time'
      ? `Both switches are off (dead time). The inductor current cannot stop, so a body diode takes it: ${st.carriers.join(', ') || 'none'}.`
      : `${st.interval}: the gate is high, so the channel conducts in either direction.`,
    st.il >= 0 ? 'iL > 0: power flows from the battery towards the link (motoring).' : 'iL < 0: power flows from the link back into the battery (regeneration).',
  ]
  return { elements: els, text: stagePathText(st), reasons }
}

export function stageStatus(st: StageState, r: StageRun): StatusInfo {
  const charging = Math.sign(st.dildt) === Math.sign(st.il)
  const what =
    st.interval === 'dead time'
      ? `${st.carriers.join(' ') || 'nothing'} carries iL`
      : st.interval === 'S2 on'
        ? st.il >= 0
          ? 'the battery stores energy in L'
          : 'L gives energy to the battery'
        : st.il >= 0
          ? 'L and the battery push energy into the link'
          : 'the link stores energy in L'
  return {
    headline: `${st.interval === 'dead time' ? 'Dead time' : `${st.interval}`} · ${what} · iL ${formatA(st.il, true)} ${charging ? '(|iL| rising)' : '(|iL| falling)'}`,
    facts: [`Vlink ${formatV(st.vlink, false)}`, r.params.power >= 0 ? `motoring ${kw(r.params.power)}` : `regenerating ${kw(-r.params.power)}`, `D ${pct(r.params.duty, 1)}`],
    tone: st.interval === 'dead time' ? 'idle' : 'on',
  }
}

// ── WHY ───────────────────────────────────────────────────────────────────────────────────────────────

export function stageWhy(r: StageRun, st: StageState, m: StageMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const vL = st.dildt * p.l
  cards.push({
    id: 'now',
    question: `What is happening now? (${st.interval})`,
    what:
      st.interval === 'S2 on'
        ? `S2 connects the switch node to ground. The inductor sees vL = ${formatV(vL)}, so iL ${st.il >= 0 ? 'rises' : 'falls in magnitude'} at ${slope(st.dildt)}.`
        : st.interval === 'S1 on'
          ? `S1 connects the switch node to the link. vL = Vbat − Vlink = ${formatV(vL)}, so iL changes at ${slope(st.dildt)}.`
          : `Both switches are off for ${formatSI(p.td, 's')}. The body diode ${st.carriers.join(', ') || '—'} carries the inductor current.`,
    why:
      st.interval === 'dead time'
        ? 'The dead time keeps S1 and S2 from ever being on together, which would short the link. The inductor current cannot change instantly, so a diode must conduct.'
        : 'The inductor voltage sets how fast its current changes: L·di/dt = vL. With S2 on it sees the battery voltage; with S1 on it sees battery minus link (negative).',
    equation: 'L·diL/dt = Vbat − vsw',
    physics: `iL now ${formatA(st.il, true)}; average over the period ${formatA(m.ilAvg, true)}, ripple ${formatA(m.ilPP)} peak-to-peak.`,
    whatIf: 'A larger L or a higher fs makes the ripple smaller: ΔiL = Vbat·D/(L·fs).',
  })
  cards.push({
    id: 'duty',
    question: 'Why is the duty ratio what it is?',
    what: `The controller holds the link at ${formatV(p.vlink, false)} with D = ${pct(m.duty)}. The ideal value is 1 − Vt/Vlink = ${pct(m.dutyIdeal)}.`,
    why:
      p.power >= 0
        ? 'In steady state the inductor’s volt-seconds balance: Vt·D = (Vlink − Vt)·(1 − D), so Vlink = Vt/(1 − D). The losses and the dead time (in which D1 conducts as if S1 were on) need a little more S2 time.'
        : 'Regenerating, the same balance holds with the current reversed. Now the dead time acts as extra S2 time (D2 conducts), and the losses are paid by the link. Both make the duty a little smaller than ideal.',
    equation: 'Vlink = Vt / (1 − D)',
    physics: `Dead time ${formatSI(p.td, 's')} × fs = ${pct(p.td * p.fs)} of the period. Losses ${formatW(m.pLoss)}.`,
    whatIf: 'A lower battery voltage needs a larger D (more boost) for the same link voltage.',
  })
  cards.push({
    id: 'flow',
    question: m.direction === 'motoring' ? 'Where does the power go?' : 'How does power come back?',
    what: m.direction === 'motoring' ? `${formatW(m.pBat)} leave the battery terminals and ${formatW(m.pLink)} reach the inverter.` : `${formatW(-m.pLink)} come from the inverter and ${formatW(-m.pBat - m.pSw)} reach the battery.`,
    why: 'The half-bridge is synchronous: both switches can carry current both ways. When the inverter pushes power into the link (braking), the average inductor current simply turns negative. The same circuit then works as a buck from the link to the battery.',
    equation: 'η = P_out / P_in',
    physics: `Efficiency ${pct(m.efficiency)}: conduction ${formatW(m.pCond)} (Ron, DCR, diodes, ESR) + switching ${formatW(m.pSw)} (${m.hardEdges} hard edges per period).`,
    whatIf: 'At light load the ripple current and the switching edges still cost about the same, so the efficiency falls.',
  })
  return cards
}

// ── EVENTS ────────────────────────────────────────────────────────────────────────────────────────────

export function stageEventLabel(e: RunEvent): string {
  const d = e.device ?? ''
  if (e.kind === 'gate-on') return `${d} gate on`
  if (e.kind === 'gate-off') return `${d} gate off`
  if (e.kind === 'diode-on') return `${d} starts conducting`
  if (e.kind === 'diode-off') return `${d} stops`
  return e.kind
}
export function stageEventWhy(e: RunEvent): string {
  const il = formatA(e.values.il ?? NaN, true)
  if (e.kind === 'gate-off') return `iL = ${il}. The dead time begins: a body diode takes the inductor current.`
  if (e.kind === 'gate-on') return `iL = ${il}. ${(e.device === 'S2' && (e.values.il ?? 0) > 0) || (e.device === 'S1' && (e.values.il ?? 0) < 0) ? 'Hard turn-on: the switch takes the current from the opposite diode (switching loss).' : 'Its own diode was already conducting: it turns on at almost zero voltage (no switching loss).'}`
  if (e.kind === 'diode-on') return `iL = ${il}: the current needs a path while both switches are off.`
  return `iL = ${il}.`
}

// ── ENERGY AT THE CURSOR ──────────────────────────────────────────────────────────────────────────────

export function stageEnergy(st: StageState, r: StageRun): EnergyModel {
  const p = r.params
  const vL = st.dildt * p.l
  const ledger = [
    { id: 'bat', label: 'Battery (Voc·iL)', watts: -p.vbat * st.il, note: st.il >= 0 ? 'supplying' : 'being charged' },
    { id: 'rb', label: 'Battery resistance Rb', watts: p.rbat * st.il * st.il, note: 'heat' },
    { id: 'l', label: 'Inductor L', watts: vL * st.il, note: vL * st.il >= 0 ? 'storing' : 'releasing' },
    { id: 'dcr', label: 'Inductor DCR', watts: p.rl * st.il * st.il, note: 'heat' },
    { id: 'sw', label: 'Switches (Ron)', watts: p.ron * (st.is1 * st.is1 + st.is2 * st.is2), note: 'heat' },
    { id: 'd', label: 'Body diodes', watts: st.id1 * (p.vf + p.rd * st.id1) + st.id2 * (p.vf + p.rd * st.id2), note: 'heat' },
    { id: 'c', label: 'Link capacitor C', watts: st.vc * st.ic, note: st.vc * st.ic >= 0 ? 'storing' : 'releasing' },
    { id: 'esr', label: 'Capacitor ESR', watts: p.esr * st.ic * st.ic, note: 'heat' },
    { id: 'inv', label: 'Inverter (link side)', watts: st.vlink * st.iinv, note: st.iinv >= 0 ? 'absorbing (motoring)' : 'supplying (regenerating)' },
  ]
  const el = 0.5 * p.l * st.il * st.il
  const ec = 0.5 * p.c * st.vc * st.vc
  const ilMax = Math.max(...Array.from(r.signals.il).map(Math.abs), 1e-9)
  const vcMax = Math.max(...Array.from(r.signals.vc), 1e-9)
  return {
    ledger,
    stores: [
      { id: 'l', label: 'Inductor ½·L·iL²', joules: el, fraction: el / (0.5 * p.l * ilMax * ilMax), detail: `iL ${formatA(st.il, true)}` },
      { id: 'c', label: 'Link capacitor ½·C·v²', joules: ec, fraction: ec / (0.5 * p.c * vcMax * vcMax), detail: `vC ${formatV(st.vc, false)}` },
    ],
    balance: ledger.reduce((a, x) => a + x.watts, 0),
    tolerance: 1e-6 * Math.max(1, Math.abs(p.vbat * st.il)),
    summary: 'Switching losses are not in this instantaneous ledger: the circuit switches instantly, and its edge energies are added per period (Measurements & theory).',
  }
}

// ── SIMULATION vs THEORY ──────────────────────────────────────────────────────────────────────────────

const exCache = new WeakMap<StageRun, { ex: StageExact; dEx: number }>()
export function stageExactFor(r: StageRun) {
  let e = exCache.get(r)
  if (!e) {
    e = { ex: stageExact(r.params), dEx: exactDuty(r.params, r.params.duty) }
    exCache.set(r, e)
  }
  return e
}

export function compareStage(r: StageRun, m: StageMeasurements): CompareResult {
  const p = r.params
  const { ex, dEx } = stageExactFor(r)
  const tb = stageTextbook(p, m.vbtAvg, m.ilAvg)
  const rows: CompareRow[] = []
  // the power swing (battery voltage × current ripple) is the scale of the power rows: at light load the average
  // power is a small difference of large flows within each period
  const pScale = Math.max(Math.abs(ex.pBat), m.vbtAvg * ex.ilPP)
  const add = (key: string, label: string, unit: string, sim: number, exact: number, tol: number, t: { v: number; f: string; a: string[] } | null, scale?: number) => {
    const den = scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const textbook: TextbookValue | null = t ? { key, value: t.v, formula: t.f, assumptions: t.a } : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, absolute: false, textbook, textbookError: t ? (sim - t.v) / Math.max(Math.abs(t.v), 1e-30) : null })
  }
  const ideal = ['ideal synchronous boost', 'no losses, no dead time', 'continuous current']
  // tolerances (trapezoidal rule at the run's steps per period vs the exact flow): averages and the inductor ripple
  // agree to ~1e-5; the capacitor ripple's interior extremum is sampled (1e-3); the switching losses use the current
  // at each edge, small at light load (1e-3); the body diodes conduct only in the dead times (two or three steps),
  // so their loss is quadrature-limited (1 %)
  add('duty', 'Duty ratio for the target', '%', m.duty, dEx, 1e-4, { v: tb.dutyIdeal, f: '1 − Vt/Vlink', a: ideal })
  add('vlinkAvg', 'Link voltage, average', 'V', m.vlinkAvg, ex.vlinkAvg, 1e-4, { v: tb.vlink, f: 'Vt / (1 − D)', a: ideal })
  // (relative to the current's swing: at light load the average is a small difference of a large ripple)
  add('ilAvg', 'Battery current (iL), average', 'A', m.ilAvg, ex.ilAvg, 1e-4, { v: tb.il, f: 'P / Vt', a: ['lossless'] }, Math.max(Math.abs(ex.ilAvg), ex.ilPP))
  add('ilPP', 'Inductor ripple ΔiL', 'A', m.ilPP, ex.ilPP, 1e-4, { v: tb.ilPP, f: 'Vt·D / (L·fs)', a: ['constant voltages over the period'] })
  add('vcPP', 'Link capacitor ripple ΔvC', 'V', m.vcPP, ex.vcPP, 1e-3, { v: tb.vlinkPP, f: '|Ilink|·D / (C·fs)', a: ['the capacitor alone feeds the inverter while S2 is on'] })
  add('pBat', 'Battery terminal power', 'W', m.pBat, ex.pBat, 1e-4, null, pScale)
  add('pLink', 'Inverter power', 'W', m.pLink, ex.pLink, 1e-4, null, pScale)
  add('pCond', 'Conduction losses', 'W', m.pCond, ex.pCond, 3e-3, { v: tb.pCond, f: '(I² + ΔiL²/12)·(Ron + DCR)', a: ['triangular ripple', 'no diodes, no ESR'] })
  add('pD', 'Body-diode losses (dead times)', 'W', m.pD, ex.pD, 1e-2, null, Math.max(ex.pD, 1e-3 * m.pCond))
  add('pSw', 'Switching losses', 'W', m.pSw, ex.pSw, 1e-3, { v: tb.pSw, f: 'fs·(Eon + Eoff)·(V/600 V)·(I/300 A)', a: ['both edges hard at the average current'] })
  if (Math.abs(m.pLink) >= 2000) add('efficiency', 'Efficiency', '%', m.efficiency, ex.efficiency, 1e-4, null)
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `SIMULATION: the switched-circuit engine (trapezoidal rule, ${p.stepsPerPeriod} steps per period, diode transitions bisected, periodic steady state by shooting), with the controller's duty found by iterating the simulation. THEORY: the exact periodic steady state of the same piecewise-linear circuit (matrix exponentials), its duty found on the exact model.`,
    note: `Switching energies are datasheet-style values scaled by the simulated V and I at each edge. Not modelled: inductor core loss, gate-drive power, reverse recovery, temperature. ${Math.abs(m.pLink) < 2000 ? 'Below 2 kW the efficiency is not compared: the output is a small difference of large circulating flows.' : ''}`,
  }
}

// ── READINGS ──────────────────────────────────────────────────────────────────────────────────────────

export function stageReadings(m: StageMeasurements, r: StageRun): Reading[] {
  const p = r.params
  return [
    reading('vlink', 'DC-link voltage, average', formatV(m.vlinkAvg, false), `target ${formatV(p.vlink, false)}`),
    reading('il', 'Battery current, average', formatA(m.ilAvg, true), m.direction === 'motoring' ? 'out of the battery (motoring)' : 'into the battery (regenerating)'),
    reading('eff', 'Efficiency', pct(m.efficiency), `losses ${formatW(m.pLoss)}`),
    reading('duty', 'Duty ratio of S2', pct(m.duty), `ideal 1 − Vt/Vlink = ${pct(m.dutyIdeal)}`, 'standard'),
  ]
}

// ── LESSONS, EXPERIMENTS, PREDICTIONS ─────────────────────────────────────────────────────────────────

type L = Lesson<StageParams, StageRun, StageMeasurements, StageState>
/** A time in the last displayed period at a fraction of Ts. */
const inPeriod = (r: StageRun, f: number) => (r.params.periods - 1 + f) * r.params.ts
const win = (r: StageRun): [number, number] => [Math.max(0, (r.params.periods - 2) * r.params.ts), r.params.periods * r.params.ts]

export const STAGE_LESSONS: L[] = [
  {
    id: 'boost',
    title: 'Lifting the battery to the DC link',
    summary: 'Two switches, one inductor: how 350 V become 650 V.',
    // a finer time step, so that the 250-ns dead time spans a few samples on the scope
    base: { power: 60e3, vbat: 350, vlink: 650, stepsPerPeriod: 600, periods: 2 },
    check: {
      question: 'While motoring, the duty the controller needs is a little larger than 1 − Vbat/Vlink. Why?',
      options: ['the losses and the dead time must be made up by a longer S2 on-time', 'the textbook formula is wrong for synchronous converters', 'the link capacitor needs extra charge every period'],
      answer: 0,
      explain: 'The ideal law Vlink = Vt/(1 − D) holds without losses. The voltage lost across Ron and the DCR, and the dead time in which D1 conducts as if S1 were on, both lower the link voltage. A slightly longer S2 time makes up for it.',
    },
    steps: [
      {
        title: '1 · S2 on: the inductor charges from the battery',
        at: (r) => inPeriod(r, (r.params.td * r.params.fs + r.params.duty) / 2),
        window: win,
        channels: ['g2', 'il', 'vsw'],
        look: 'While S2’s gate is high, iL ramps up.',
        body: (st, _m, r) => `S2 grounds the switch node. The inductor sees the battery, ${formatV(st.vbt, false)}, so iL rises at ${slope(st.dildt)}: Vbat/L = ${formatV(r.params.vbat, false)}/${formatSI(r.params.l, 'H')}.`,
      },
      {
        title: '2 · Dead time: a diode takes over',
        at: (r) => inPeriod(r, r.params.duty + (r.params.td * r.params.fs) / 2),
        window: (r) => [inPeriod(r, r.params.duty) - 2 * r.params.td, inPeriod(r, r.params.duty) + 4 * r.params.td],
        channels: ['g1', 'g2', 'il', 'vsw'],
        look: 'Both gates low for a moment; the switch node jumps to the link (+ a diode drop).',
        body: (st, _m, r) => `For ${formatSI(r.params.td, 's')} both switches are off. The inductor current cannot stop, so ${st.carriers.join(' ') || 'a diode'} carries it, and the switch node sits at ${formatV(st.vsw, false)}.`,
      },
      {
        title: '3 · S1 on: the inductor pushes into the link',
        at: (r) => inPeriod(r, (r.params.duty + 1) / 2),
        window: win,
        channels: ['g1', 'il', 'vlink'],
        look: 'With S1 on, iL ramps down: vL = Vbat − Vlink is negative.',
        body: (st) => `S1 connects the switch node to the link at ${formatV(st.vlink, false)}. Now vL = Vbat − Vlink < 0 and iL falls at ${slope(st.dildt)}. The energy stored in L goes to the link.`,
      },
      {
        title: '4 · Volt-seconds: the boost law',
        at: (r) => inPeriod(r, 0.95),
        window: win,
        channels: ['il', 'vlink'],
        look: 'The rise during S2 on equals the fall during S1 on.',
        body: (_st, m) => `Over a period iL returns to its start: Vt·D = (Vlink − Vt)·(1 − D), so Vlink = Vt/(1 − D). The controller found D = ${pct(m.duty)}; the ideal value is ${pct(m.dutyIdeal)}. Efficiency ${pct(m.efficiency)}.`,
      },
    ],
  },
  {
    id: 'regen',
    title: 'Braking: power flows back',
    summary: 'The same half-bridge, with the current reversed.',
    base: { power: -50e3, vbat: 350, vlink: 650, stepsPerPeriod: 600, periods: 2 },
    check: {
      question: 'When the car brakes and the inverter feeds power back, the stage…',
      options: ['keeps switching the same way; the inductor current turns negative and power flows to the battery', 'hands over to a separate charger circuit', 'needs its duty ratio to drop to zero'],
      answer: 0,
      explain: 'Both switches conduct in both directions, so the average inductor current can simply reverse. The volt-second balance, and hence the duty, stays about the same. Only the losses now come out of the link power instead of the battery power.',
    },
    steps: [
      {
        title: '1 · S1 on: the link drives current into L',
        at: (r) => inPeriod(r, (r.params.duty + 1) / 2),
        window: win,
        channels: ['g1', 'il', 'vlink'],
        look: 'iL is negative and grows in magnitude while S1 is on.',
        body: (st) => `iL = ${formatA(st.il, true)}: current flows from the link through S1 into the inductor and on to the battery. Its magnitude grows: the link stores energy in L.`,
      },
      {
        title: '2 · S2 on: the inductor charges the battery',
        at: (r) => inPeriod(r, (r.params.td * r.params.fs + r.params.duty) / 2),
        window: win,
        channels: ['g2', 'il', 'vsw'],
        look: 'Now |iL| shrinks while S2 is on.',
        body: (st) => `With S2 on, the inductor keeps pushing current into the battery (${formatA(st.il, true)}). Its magnitude falls: the inductor gives up the energy it took from the link.`,
      },
      {
        title: '3 · In the dead time: the lower diode',
        at: (r) => inPeriod(r, (r.params.td * r.params.fs) / 2),
        window: (r) => [inPeriod(r, 0) - 2 * r.params.td, inPeriod(r, 0) + 4 * r.params.td],
        channels: ['g1', 'g2', 'il', 'vsw'],
        look: 'Both gates low: the switch node drops just below ground.',
        body: (st) => `With the current reversed, the dead time is carried by ${st.carriers.join(' ') || 'D2'}: the switch node sits at ${formatV(st.vsw, false)}.`,
      },
      {
        title: '4 · Power into the battery',
        at: (r) => inPeriod(r, 0.95),
        window: win,
        channels: ['il', 'pbat', 'plink'],
        look: 'Both powers are negative: energy flows back.',
        body: (_st, m) => `The inverter returns ${formatW(-m.pLink)}; ${formatW(-m.pBat - m.pSw)} reach the battery (η = ${pct(m.efficiency)}). The duty is ${pct(m.duty)}, close to the motoring value.`,
      },
    ],
  },
  {
    id: 'efficiency',
    title: 'Efficiency across the load',
    summary: 'Which losses matter at light load and at full load.',
    base: { power: 60e3 },
    check: {
      question: 'Going from 60 kW to 150 kW, the efficiency falls mainly because…',
      options: ['the conduction losses grow with the square of the current', 'the switching losses disappear', 'the link voltage drops'],
      answer: 0,
      explain: 'The conduction losses (Ron, DCR, ESR) grow as I². The switching losses grow only in proportion to I. At high power the I² term wins.',
    },
    steps: [
      {
        title: '1 · Light load: the ripple and the edges',
        params: { power: 5e3 },
        at: (r) => inPeriod(r, 0.5),
        window: win,
        channels: ['il', 'g2'],
        look: 'At 5 kW the ripple is bigger than the average: iL even goes negative.',
        body: (_st, m) => `At ${formatW(m.pLink)} the average current is only ${formatA(m.ilAvg, true)}, but the ripple is ${formatA(m.ilPP)}. Losses: conduction ${formatW(m.pCond)}, switching ${formatW(m.pSw)}. Efficiency ${pct(m.efficiency)}.`,
      },
      {
        title: '2 · Medium load',
        params: { power: 60e3 },
        at: (r) => inPeriod(r, 0.5),
        window: win,
        channels: ['il', 'g2'],
        look: 'The ripple now rides on a large average current.',
        body: (_st, m) => `At ${formatW(m.pLink)}: conduction ${formatW(m.pCond)}, switching ${formatW(m.pSw)}. Efficiency ${pct(m.efficiency)}.`,
      },
      {
        title: '3 · Full load: I² wins',
        params: { power: 150e3 },
        at: (r) => inPeriod(r, 0.5),
        window: win,
        channels: ['il', 'g2'],
        look: 'A very large average current with the same ripple.',
        body: (_st, m) => `At ${formatW(m.pLink)}: conduction ${formatW(m.pCond)} (it grows as I²), switching ${formatW(m.pSw)} (it grows as I). Efficiency ${pct(m.efficiency)}. Open "Efficiency vs load" in Measurements & theory for the whole curve.`,
      },
    ],
  },
]

export const STAGE_EXPERIMENTS: Array<Experiment<StageParams, StageMeasurements>> = [
  {
    id: 'regen',
    title: 'Brake: reverse the power',
    change: (p) => ({ power: -Math.min(Math.abs(p.power), 100e3) }),
    question: () => 'The car brakes and the inverter feeds the same power back into the link. The duty ratio of S2…',
    choices: ['stays close to the same value', 'drops to zero', 'doubles'],
    judge: (b, a) => (Math.abs(a.duty - b.duty) < 0.05 ? 0 : a.duty < 0.05 ? 1 : 2),
    rows: ['duty', 'ilAvg', 'efficiency'],
    why: (b, a) => `D ${pct(b.duty)} → ${pct(a.duty)}; the battery current ${formatA(b.ilAvg, true)} → ${formatA(a.ilAvg, true)}. The boost law Vlink = Vt/(1 − D) does not care about the current direction. The small change comes from the dead time and the losses changing sides.`,
  },
  {
    id: 'fs',
    title: 'Switch 2.5 times faster',
    change: (p) => ({ fs: p.fs * 2.5 }),
    question: () => 'fs rises from 20 to 50 kHz (same L). The efficiency…',
    choices: ['falls: more switching edges per second', 'rises: less ripple', 'stays the same'],
    judge: (b, a) => (a.efficiency < b.efficiency - 1e-5 ? 0 : a.efficiency > b.efficiency + 1e-5 ? 1 : 2),
    rows: ['efficiency', 'pSw', 'ilPP'],
    why: (b, a) => `η ${pct(b.efficiency)} → ${pct(a.efficiency)}. Switching losses ${formatW(b.pSw)} → ${formatW(a.pSw)}. The ripple shrinks (${formatA(b.ilPP)} → ${formatA(a.ilPP)}), but that saves far less conduction loss than the extra edges cost.`,
  },
  {
    id: 'vbat',
    title: 'A lower battery voltage',
    change: () => ({ vbat: 250 }),
    question: () => 'The battery is at 250 V instead of 350 V (same power, same link). The battery current…',
    choices: ['rises — and the losses rise more', 'falls', 'stays the same'],
    judge: (b, a) => (a.ilAvg > 1.2 * b.ilAvg ? 0 : a.ilAvg < 0.95 * b.ilAvg ? 1 : 2),
    rows: ['ilAvg', 'duty', 'efficiency'],
    why: (b, a) => `Current ${formatA(b.ilAvg)} → ${formatA(a.ilAvg)} (P/V), duty ${pct(b.duty)} → ${pct(a.duty)}, efficiency ${pct(b.efficiency)} → ${pct(a.efficiency)}. The conduction losses grow with I².`,
  },
]

export function stagePredictions(seed: number): Array<PredictTask<StageParams, StageMeasurements>> {
  const vbat = [300, 350, 400][seed % 3]
  const power = [40e3, 60e3, 80e3][seed % 3]
  const l = [100e-6, 150e-6, 200e-6][seed % 3]
  return [
    {
      id: 'duty',
      prompt: `Battery ${vbat} V (open circuit, 50 mΩ), link target 650 V, ${power / 1000} kW. Predict the duty ratio of S2.`,
      params: { vbat, power, vlink: 650 },
      kind: 'number',
      unit: '%',
      answer: (m) => 100 * m.duty,
      tolerance: 0.03,
      hint: 'Volt-second balance on the inductor: Vlink = Vbat/(1 − D). The terminal voltage is a little below Voc under load.',
      theory: (p) => {
        const rp = resolveStage(p).params
        return `D ≈ 1 − Vt/Vlink = 1 − ${rp.vlink > 0 ? (rp.vlink * (1 - rp.dutyIdeal)).toFixed(1) : '—'} V/${rp.vlink} V = ${pct(rp.dutyIdeal)}; losses and the dead time add a little (the simulation found the rest).`
      },
    },
    {
      id: 'ripple',
      prompt: `Battery 350 V, link 650 V, fs = 20 kHz, L = ${(l * 1e6).toFixed(0)} µH. Predict the inductor ripple ΔiL (peak-to-peak).`,
      params: { l, vbat: 350, vlink: 650, power: 60e3, fs: 20e3 },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ilPP,
      tolerance: 0.05,
      hint: 'During S2 on (D·Ts), the inductor sees the battery: ΔiL = Vbat·D/(L·fs).',
      theory: (p) => {
        const rp = resolveStage(p).params
        const vt = rp.vlink * (1 - rp.dutyIdeal)
        return `ΔiL = Vt·D/(L·fs) = ${vt.toFixed(0)} V × ${rp.dutyIdeal.toFixed(3)} / (${formatSI(rp.l, 'H')} × ${formatSI(rp.fs, 'Hz')}) = ${formatA((vt * rp.dutyIdeal) / (rp.l * rp.fs))}`
      },
    },
    {
      id: 'current',
      prompt: `${power / 1000} kW into the inverter from a ${vbat} V battery (50 mΩ). Predict the average battery current.`,
      params: { vbat, power, vlink: 650 },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ilAvg,
      tolerance: 0.03,
      hint: 'Power balance: P ≈ Vt·I (the stage is about 99 % efficient); the terminal voltage sags by Rb·I.',
      theory: (p) => {
        const rp = resolveStage(p).params
        const vt = rp.vlink * (1 - rp.dutyIdeal)
        return `I ≈ P/Vt = ${formatW(rp.power)}/${vt.toFixed(1)} V = ${formatA(rp.power / vt)} (lossless; the losses add about 0.5 %).`
      },
    },
    {
      id: 'deadtime',
      prompt: 'Regenerating 40 kW (the inverter feeds the link). During the dead times, which device carries the inductor current?',
      params: { power: -40e3 },
      kind: 'choice',
      choices: ['D1, the upper body diode', 'D2, the lower body diode', 'nothing: the current is zero then'],
      answer: (m) => (m.deadDiode === 1 ? 0 : m.deadDiode === 2 ? 1 : 2),
      hint: 'Which way does iL flow when braking? The diode whose direction matches it conducts.',
      theory: () => 'iL < 0 flows from the switch node into the inductor: it can only come up through D2 (anode at ground) when both switches are off.',
    },
  ]
}

export const STAGE_MEASURE_LABELS = {
  duty: { label: 'Duty ratio of S2', fmt: (v: number) => pct(v) },
  dutyIdeal: { label: 'Ideal duty 1 − Vt/Vlink', fmt: (v: number) => pct(v) },
  vlinkAvg: { label: 'Link voltage, average', fmt: (v: number) => formatV(v, false) },
  vlinkPP: { label: 'Link ripple ΔVlink (with ESR steps)', fmt: (v: number) => formatSI(v, 'V') },
  vcPP: { label: 'Capacitor ripple ΔvC', fmt: (v: number) => formatSI(v, 'V') },
  ilAvg: { label: 'Battery current, average', fmt: (v: number) => formatA(v, true) },
  ilPP: { label: 'Inductor ripple ΔiL', fmt: (v: number) => formatA(v) },
  ilMax: { label: 'iL, max', fmt: (v: number) => formatA(v, true) },
  ilMin: { label: 'iL, min', fmt: (v: number) => formatA(v, true) },
  ilRms: { label: 'iL, RMS', fmt: (v: number) => formatA(v) },
  vbtAvg: { label: 'Battery terminal voltage', fmt: (v: number) => formatV(v, false) },
  pBat: { label: 'Battery terminal power', fmt: (v: number) => formatW(v) },
  pLink: { label: 'Inverter power', fmt: (v: number) => formatW(v) },
  pS1: { label: 'S1 conduction loss', fmt: (v: number) => formatW(v) },
  pS2: { label: 'S2 conduction loss', fmt: (v: number) => formatW(v) },
  pD: { label: 'Body-diode losses', fmt: (v: number) => formatW(v) },
  pDcr: { label: 'Inductor DCR loss', fmt: (v: number) => formatW(v) },
  pEsr: { label: 'Capacitor ESR loss', fmt: (v: number) => formatW(v) },
  pCond: { label: 'Conduction losses', fmt: (v: number) => formatW(v) },
  pSw: { label: 'Switching losses', fmt: (v: number) => formatW(v) },
  pLoss: { label: 'Total losses', fmt: (v: number) => formatW(v) },
  hardEdges: { label: 'Hard-switched edges per period', fmt: (v: number) => String(v) },
  efficiency: { label: 'Efficiency', fmt: (v: number) => pct(v) },
  direction: { label: 'Power flow', fmt: (v: number) => String(v) },
}

