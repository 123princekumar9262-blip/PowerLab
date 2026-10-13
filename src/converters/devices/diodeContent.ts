import type { AnalysisCategory, CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, StatusInfo, TextbookValue, WhyCard } from '../../lab/types.ts'
import type { CurrentPath, EnergyModel, NextConsequence } from '../../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { DIODE_DEFAULTS, diodeDerived, exactDiode, measureDiode, shockleyV, type DiodeMeasurements, type DiodeParams, type DiodeRun, type DiodeRegion, type SwitchRegion } from './diode.ts'

export { measureDiode }

/** The phase of the commutation at an instant (from the simulated diode and switch regions). */
export type DiodePhase = 'freewheeling' | 'current fall' | 'reverse current (stored charge)' | 'recovery tail' | 'blocking'

export interface DiodeState {
  k: number
  t: number
  id: number
  vd: number
  iq: number
  vq: number
  vls: number
  didt: number
  qe: number
  qm: number
  qrr: number
  pq: number
  eq: number
  pd: number
  ed: number
  dev: DiodeRegion
  sw: SwitchRegion
  phase: DiodePhase
}

/** A rate in A/µs (the unit datasheets use for di/dt). */
export const formatSlope = (aPerS: number) => `${(aPerS / 1e6).toFixed(Math.abs(aPerS) >= 1e8 ? 0 : 1)} A/µs`
const formatQ = (q: number) => formatSI(q, 'C')

/** The measurements of a run, computed once (the cursor and the lessons read them many times). */
const measured = new WeakMap<DiodeRun, DiodeMeasurements>()
export function diodeMeasured(r: DiodeRun): DiodeMeasurements {
  let m = measured.get(r)
  if (!m) {
    m = measureDiode(r)
    measured.set(r, m)
  }
  return m
}

export function diodeStateAt(r: DiodeRun, k: number): DiodeState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const d = diodeDerived(p, s.id[i], s.qm[i] * 1e-9, r.modes[i])
  const m = diodeMeasured(r)
  let phase: DiodePhase
  if (d.sw === 'off') phase = 'freewheeling'
  else if (d.dev === 'Fp') phase = 'current fall'
  else if (d.dev === 'Fn') phase = 'reverse current (stored charge)'
  else phase = -s.id[i] > 0.02 * (m.irr ?? 0) && (m.irr ?? 0) > 1e-6 ? 'recovery tail' : 'blocking'
  return {
    k: i,
    t: r.time[i],
    id: s.id[i],
    vd: s.vd[i],
    iq: s.iq[i],
    vq: s.vq[i],
    vls: s.vls[i],
    didt: d.didt,
    qe: s.qe[i] * 1e-9,
    qm: s.qm[i] * 1e-9,
    qrr: s.qrr[i],
    pq: s.pq[i],
    eq: s.eq[i],
    pd: s.pd[i],
    ed: s.ed[i],
    dev: d.dev,
    sw: d.sw,
    phase,
  }
}

const SW_TEXT: Record<SwitchRegion, string> = { off: 'OFF', sat: 'turning on (current set by its gate)', ohm: 'fully ON (Ron)' }
const DEV_TEXT: Record<DiodeRegion, string> = { Fp: 'conducting forward', Fn: 'conducting BACKWARDS (stored charge)', R: 'recovered: blocking' }

export function diodeView(st: DiodeState): StateView {
  return {
    badge: { text: st.phase, tone: st.phase === 'freewheeling' ? 'on' : st.phase === 'blocking' ? 'off' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'diode current iD', v: formatA(st.id) },
      { k: 'diode voltage vAK', v: formatV(st.vd) },
      { k: 'diode', v: DEV_TEXT[st.dev], full: true, tone: st.dev === 'R' ? 'off' : 'on-d' },
      { k: 'switch', v: `${SW_TEXT[st.sw]} · ${formatA(st.iq)}`, full: true, tone: st.sw === 'off' ? 'off' : 'on-q' },
      { k: 'diD/dt', v: formatSlope(st.didt), min: 'standard' },
      { k: 'junction charge qE', v: formatQ(st.qe), min: 'standard' },
      { k: 'base charge qM', v: formatQ(st.qm), min: 'standard' },
      { k: 'switch voltage', v: formatV(st.vq), min: 'standard' },
      { k: 'switch energy so far', v: formatSI(st.eq, 'J'), min: 'engineer' },
      { k: 'Ls voltage', v: formatV(st.vls), min: 'engineer' },
    ],
    path: diodePathText(st),
  }
}

function diodePathText(st: DiodeState): string {
  if (st.sw === 'off') return `I0 circulates: load inductor → diode → Ls → back to the load (${formatA(st.id)})`
  if (st.dev === 'R' && Math.abs(st.id) < 1e-6) return `I0 flows from Vdc through the load and the switch (${formatA(st.iq)}); the diode blocks ${formatV(-st.vd, false)}`
  if (st.id >= 0) return `I0 splits: switch ${formatA(st.iq)} and diode ${formatA(st.id)} — the switch takes the current over`
  return `Vdc → Ls → diode (backwards, ${formatA(-st.id)}) → switch: the switch carries I0 + ${formatA(-st.id)} = ${formatA(st.iq)}`
}

export function diodeStatus(st: DiodeState): StatusInfo {
  const facts: string[] = []
  if (st.phase === 'freewheeling') facts.push(`diode carries I0 = ${formatA(st.id)}`, 'switch OFF', `stored charge ${formatQ(st.qm)}`)
  else if (st.phase === 'current fall') facts.push(`iD falling at ${formatSlope(-st.didt)}`, `switch ${formatA(st.iq)}`)
  else if (st.phase === 'reverse current (stored charge)') facts.push(`iD = ${formatA(st.id)} (backwards)`, `junction charge ${formatQ(st.qe)} left`)
  else if (st.phase === 'recovery tail') facts.push(`reverse voltage ${formatV(-st.vd, false)}`, `iD = ${formatA(st.id)} decaying`)
  else facts.push(`blocking ${formatV(-st.vd, false)}`, `switch carries ${formatA(st.iq)}`)
  return { headline: st.phase === 'freewheeling' ? 'Diode ON · freewheeling' : st.phase === 'blocking' ? 'Diode OFF · blocking' : `Reverse recovery · ${st.phase}`, facts, tone: st.phase === 'freewheeling' ? 'on' : st.phase === 'blocking' ? 'off' : 'idle' }
}

/** What happens next, quoting the run's own next event (or the tail's own time constant). */
export function diodeNext(r: DiodeRun, st: DiodeState, m: DiodeMeasurements): NextConsequence | null {
  const p = r.params
  if (st.phase === 'freewheeling') return { text: `The switch turns on at t = ${formatTime(p.ton)}: the diode current then falls at ${formatSlope(m.didt ?? NaN)} and the switch takes over I0.`, time: p.ton }
  if (st.phase === 'current fall' && m.t0 !== null)
    return { text: `iD reaches zero at t = ${formatTime(m.t0)} — but the diode does not block yet: its stored charge lets it conduct backwards until t = ${formatTime(m.tRec ?? NaN)}.`, time: m.t0 }
  if (st.phase === 'reverse current (stored charge)' && m.tRec !== null)
    return { text: `The junction charge reaches zero at t = ${formatTime(m.tRec)}: the reverse current peaks at Irr = ${formatA(m.irr ?? NaN)} and the diode starts to block — its voltage jumps to −${formatV(m.vrm, false)}.`, time: m.tRec }
  if (st.phase === 'recovery tail')
    return { text: `The remaining base charge decays with τrr = ${formatTime(p.tauRR)}: the reverse current dies out and the reverse voltage settles at Vdc = ${formatV(p.vdc, false)}.`, time: null }
  return { text: `Nothing more happens in this test: the diode blocks Vdc and the switch carries I0. The recovery cost the switch ${formatSI(m.deon, 'J')} extra.`, time: null }
}

export function diodeEnergyModel(st: DiodeState, r: DiodeRun): EnergyModel {
  const p = r.params
  const ledger = [
    { id: 'src', label: 'Source Vdc', watts: -p.vdc * st.iq, note: 'supplies Vdc·iQ (negative = delivering)' },
    { id: 'q', label: 'Switch Q', watts: st.pq, note: 'vQ·iQ as heat' },
    { id: 'd', label: 'Diode D', watts: st.pd, note: 'vAK·iD as heat (large in the tail: high voltage and reverse current)' },
    { id: 'ls', label: 'Loop inductance Ls', watts: st.vls * st.id, note: 'stores ½·Ls·iD² (+ storing, − releasing)' },
    { id: 'load', label: 'Load inductor (I0)', watts: (p.vdc - st.vq) * p.i0, note: '(Vdc − vQ)·I0: the load inductor stores or returns energy' },
  ]
  let elMax = 0
  for (let k = 0; k < r.length; k++) elMax = Math.max(elMax, 0.5 * p.ls * r.signals.id[k] ** 2)
  const el = 0.5 * p.ls * st.id * st.id
  return {
    ledger,
    stores: [{ id: 'ls', label: 'Loop inductance ½·Ls·iD²', joules: el, fraction: el / Math.max(elMax, 1e-18), detail: `${st.vls * st.id >= 0 ? 'storing' : 'releasing'} ${formatSI(Math.abs(st.vls * st.id), 'W')}` }],
    balance: ledger.reduce((a, x) => a + x.watts, 0),
    tolerance: 1e-6 * Math.max(1e-9, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9,
  }
}

export function diodePath(st: DiodeState): CurrentPath {
  const reasons: string[] = []
  let elements: string[]
  if (st.sw === 'off') {
    elements = ['load', 'diode', 'ls']
    reasons.push('the switch is off: the load inductor forces I0 through the diode')
  } else if (st.dev === 'R' && Math.abs(st.id) < 1e-6) {
    elements = ['vdc', 'load', 'switch']
    reasons.push('the diode has recovered and blocks: all of I0 flows through the switch')
  } else {
    elements = ['vdc', 'ls', 'diode', 'switch', 'load']
    reasons.push(st.id >= 0 ? 'the switch current rises while the diode current falls (iQ + iD = I0)' : 'the diode conducts backwards while its stored charge is removed: the switch carries I0 plus that reverse current')
  }
  return { elements, text: diodePathText(st), reasons }
}

export function diodeReadings(m: DiodeMeasurements): Reading[] {
  const rd = (id: string, label: string, formatted: string, note: string): Reading => ({ id, label, ...splitUnit(formatted), note })
  return [
    rd('irr', 'Peak reverse current', formatA(m.irr ?? NaN), 'Irr'),
    rd('trr', 'Reverse-recovery time', formatTime(m.trr ?? NaN), 'trr = ta + tb'),
    rd('qrr', 'Recovered charge', formatQ(m.qrr), 'Qrr ≈ ½·Irr·trr'),
    rd('deon', 'Extra switch turn-on energy', formatSI(m.deon, 'J'), 'ΔEon vs a charge-free diode'),
  ]
}

/** Split a formatted value "13.11 A" into the reading's value and unit. */
export const splitUnit = (s: string) => {
  const i = s.lastIndexOf(' ')
  return i > 0 ? { value: s.slice(0, i), unit: s.slice(i + 1) } : { value: s, unit: '' }
}

export function diodeWhy(r: DiodeRun, st: DiodeState, m: DiodeMeasurements): WhyCard[] {
  const p = r.params
  const lim = m.limit === 'gate' ? `the switch's gate (S = ${formatSlope(p.didt)})` : `the loop inductance (Vdc/Ls = ${formatSlope(p.vdc / p.ls)})`
  const phaseCard: Record<DiodePhase, Omit<WhyCard, 'id' | 'question'>> = {
    freewheeling: {
      what: `The switch is off. The load inductor keeps I0 = ${formatA(p.i0)} flowing, so it flows through the diode, which drops ${formatV(st.vd, false)}.`,
      why: `A conducting PN diode is flooded with electrons and holes. To carry ${formatA(p.i0)} it needs a stored charge qM = τ·I0 = ${formatQ(st.qm)} in its base (τ = ${formatTime(p.tau)}, the carrier lifetime).`,
      equation: `Vf = n·VT·ln(1 + I0/Is) + Rs·I0 = ${formatV(p.vf, false)};  qM = τ·I0`,
      physics: 'In steady state the charge is replenished exactly as fast as it recombines: dqM/dt = iD − qM/τ = 0.',
      whatIf: 'A diode with a shorter lifetime (a "fast" diode) stores less charge, but usually has a higher forward voltage.',
    },
    'current fall': {
      what: `The switch is turning on and takes over the load current: iQ = ${formatA(st.iq)}, iD = ${formatA(st.id)}, falling at ${formatSlope(-st.didt)}.`,
      why: `Because iQ + iD = I0, every ampere the switch takes is an ampere less in the diode. How fast this happens is set by ${lim}.`,
      equation: m.limit === 'gate' ? 'diD/dt = −S  (the switch voltage stays at Vdc − Ls·S)' : 'diD/dt = −(Vdc + vAK − Ron·iQ)/Ls ≈ −Vdc/Ls',
      physics: `The base charge falls behind the current: qM = ${formatQ(st.qm)} is still almost what it was — it can only leave by recombination (time constant τ) or by being pulled out by the current.`,
      whatIf: 'A faster switch (larger di/dt) leaves even more charge behind when the current reaches zero.',
    },
    'reverse current (stored charge)': {
      what: `The diode current is NEGATIVE (${formatA(st.id)}): the diode conducts backwards and its voltage is still small (${formatV(st.vd)}).`,
      why: `A diode can only block once the charge next to its junction is gone. That junction charge is qE = qM − T·|iD| = ${formatQ(st.qe)}. Until it reaches zero the diode behaves like a closed switch in both directions — the reverse current is what pulls the charge out.`,
      equation: 'dqM/dt = iD − qM/τ;  the junction recovers when qE = qM + T·iD = 0',
      physics: `Here the switch carries I0 plus the reverse current (${formatA(st.iq)}) while its voltage is ${formatV(st.vq, false)}: it dissipates ${formatSI(st.pq, 'W')} right now.`,
      whatIf: 'A diode with less stored charge (shorter τ) reaches qE = 0 sooner: smaller Irr.',
    },
    'recovery tail': {
      what: `The junction has recovered: the diode now blocks ${formatV(-st.vd, false)} while a reverse current of ${formatA(-st.id)} is still flowing.`,
      why: `The charge left in the base (${formatQ(st.qm)}) can no longer be pulled out through the junction quickly; it leaves as the tail current iD = −qM/T, which decays with τrr = τ·T/(τ + T) = ${formatTime(p.tauRR)}.`,
      equation: `vAK = vQ − Vdc − Ls·diD/dt;  peak reverse voltage ≈ Vdc + Ls·Irr/τrr = ${formatV(m.vrm, false)}`,
      physics: `The current falls back towards zero, so the loop inductance adds Ls·|di/dt| to the reverse voltage: an overshoot of ${formatV(m.overshoot, false)}. High voltage AND reverse current: the diode dissipates ${formatSI(st.pd, 'W')} now.`,
      whatIf: 'A snappier diode (shorter tail) ends the current faster — and the voltage spike gets larger.',
    },
    blocking: {
      what: `The diode blocks ${formatV(-st.vd, false)} with no current; the switch carries ${formatA(st.iq)}.`,
      why: 'All stored charge is gone: the depletion layer supports the full reverse voltage.',
      equation: 'iD = 0;  vAK = −(Vdc − vQ)',
      physics: `The recovery is over. It took trr = ${formatTime(m.trr ?? NaN)} and removed Qrr = ${formatQ(m.qrr)}.`,
      whatIf: 'Before the switch turns off again the diode must be ready to conduct — a PN diode turns on almost instantly (forward recovery is not modelled here).',
    },
  }
  return [
    { id: 'phase', question: `What is happening now? (${st.phase})`, ...phaseCard[st.phase] },
    {
      id: 'backwards',
      question: 'Why does a diode conduct backwards?',
      what: `SIMULATION: the current reverses at t = ${formatTime(m.t0 ?? NaN)}, but the diode only blocks at t = ${formatTime(m.tRec ?? NaN)}; it conducts up to Irr = ${formatA(m.irr ?? NaN)} backwards.`,
      why: 'A forward-biased PN junction is full of minority carriers (the stored charge). The junction is a barrier only when that charge is gone, and a current is the fastest way to remove it.',
      equation: 'Qrr ≈ ½·Irr·trr (triangle);  abrupt recovery: Irr ≈ √(2·Qrr·di/dt)',
      physics: `Qrr = ${formatQ(m.qrr)} was recovered here (SIMULATION) out of ${formatQ(m.qStored)} stored at I0 — the rest recombined on its own.`,
      whatIf: 'Schottky and SiC Schottky diodes store (almost) no minority charge: they have (almost) no reverse recovery.',
    },
    {
      id: 'cost',
      question: 'What does reverse recovery cost?',
      what: `SIMULATION: the switch turn-on energy is ${formatSI(m.eon, 'J')}; with a charge-free diode it would be ${formatSI(m.eon0, 'J')}. The recovery adds ΔEon = ${formatSI(m.deon, 'J')}. The diode itself dissipates ${formatSI(m.erec, 'J')}.`,
      why: m.limit === 'gate' ? 'The switch voltage can only collapse once the diode blocks. Until then the switch carries I0 + |iD| at nearly the full voltage.' : 'Here the loop inductance limits di/dt, so the switch is already fully on: most of the cost appears in the diode (tail) and as the voltage spike.',
      equation: 'ΔEon ≈ (Vdc − Ls·di/dt)·ta·(I0 + Irr/2)',
      physics: `Peak switch current I0 + Irr = ${formatA(m.ipk)}; peak diode reverse voltage ${formatV(m.vrm, false)}.`,
      whatIf: `At a switching frequency of 50 kHz the extra loss would be ΔEon·fs = ${formatSI(m.deon * 5e4, 'W')}.`,
    },
  ]
}

export function diodeEventLabel(e: RunEvent): string {
  if (e.kind === 'gate-on') return 'Switch turns on'
  const [from, to] = (e.device ?? '').split('→')
  if (from?.startsWith('Fp') && to?.startsWith('Fn')) return 'Diode current reverses (stored charge still there)'
  if (!from?.startsWith('R') && to?.startsWith('R')) return 'Junction recovers: peak reverse current Irr'
  if (from?.endsWith('sat') && to?.endsWith('ohm')) return 'Switch fully on: the loop inductance limits di/dt'
  return e.device ?? e.kind
}
export function diodeEventWhy(e: RunEvent): string {
  return `iD = ${formatA(e.values.id ?? 0)}, vAK = ${formatV(e.values.vd ?? 0)}, switch ${formatA(e.values.iq ?? 0)} at ${formatV(e.values.vq ?? 0)}.`
}

/** SIMULATION vs THEORY (the exact PWL solution) and the textbook relations. */
export function compareDiode(r: DiodeRun, m: DiodeMeasurements): CompareResult {
  const p = r.params
  const ex = exactDiode(p)
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tb: { value: number | null; formula: string; note: string } | null, tol = 0.005) => {
    if (sim === null || exact === null) return
    const error = Math.abs(sim - exact) / Math.max(Math.abs(exact), 1e-30)
    const textbook: TextbookValue | null = tb ? { key, value: tb.value, formula: tb.formula, assumptions: [tb.note] } : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, textbook, textbookError: tb?.value ? (sim - tb.value) / Math.abs(tb.value) : null })
  }
  const S = Math.min(p.didt, p.vdc / p.ls)
  const didt = m.didt ?? S
  const vSw = p.vdc - p.ls * (m.limit === 'gate' ? p.didt : p.vdc / p.ls)
  add('tf', 'Current fall time I0 → 0', 's', m.tf, ex.tf, { value: p.i0 / S, formula: 'I0/(di/dt), di/dt = min(S, Vdc/Ls)', note: 'textbook: constant slope set by the slower of the gate and the loop' })
  add('didt', 'di/dt (mean, I0 → 0)', 'A/s', m.didt, ex.didt, { value: S, formula: 'min(S, Vdc/Ls)', note: 'textbook: the loop limit ignores the diode drop and Ron' })
  add('irr', 'Peak reverse current Irr', 'A', m.irr, ex.irr, { value: Math.sqrt(2 * m.qrr * didt), formula: '√(2·Qrr·di/dt) (with the simulated Qrr)', note: 'textbook: abrupt recovery — all of Qrr removed before the peak; a soft tail carries part of Qrr after it' })
  add('ta', 'ta (zero crossing → peak)', 's', m.ta, ex.ta, { value: (m.irr ?? 0) / didt, formula: 'Irr/(di/dt)', note: 'textbook: constant slope through the zero crossing' })
  add('tb', 'tb (peak → extrapolated zero)', 's', m.tb, ex.tb, null)
  add('trr', 'Reverse-recovery time trr', 's', m.trr, ex.trr, null)
  add('qrr', 'Recovered charge Qrr', 'C', m.qrr, ex.qrr, { value: 0.5 * (m.irr ?? 0) * (m.trr ?? 0), formula: '½·Irr·trr (with the simulated Irr, trr)', note: 'textbook: a triangular reverse-current pulse' })
  add('vrm', 'Peak reverse voltage', 'V', m.vrm, ex.vrm, { value: m.tb ? p.vdc + (p.ls * (m.irr ?? 0)) / m.tb : null, formula: 'Vdc + Ls·Irr/tb', note: 'textbook: a straight-line current fall over tb; the model tail is exponential (steepest at its start)' })
  add('eon', 'Switch turn-on energy Eon', 'J', m.eon, ex.eon, null)
  add('eon0', 'Eon with a charge-free diode', 'J', m.eon0, ex.eon0, { value: 0.5 * vSw * p.i0 * (p.i0 / S), formula: '½·(Vdc − Ls·di/dt)·I0·I0/(di/dt)', note: 'textbook: a linear current ramp at constant voltage' })
  add('deon', 'Extra turn-on energy ΔEon', 'J', m.deon, ex.deon, { value: m.ta !== null ? vSw * m.ta * (p.i0 + 0.5 * (m.irr ?? 0)) : null, formula: '(Vdc − Ls·di/dt)·ta·(I0 + Irr/2)', note: 'textbook: the switch keeps its voltage until the peak, then it collapses at once' }, 0.01)
  add('erec', 'Diode recovery energy', 'J', m.erec, ex.erec, null, 0.01)
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `SIMULATION: trapezoidal time-stepping of the commutation circuit, every region change located exactly. THEORY: the exact piecewise-linear solution (matrix exponential) of the same circuit. di/dt set by ${m.limit === 'gate' ? 'the switch gate' : 'the loop inductance'}.`,
    note: 'Energies: the trapezoid over the simulated samples vs Simpson on each smooth piece of the exact solution (1 % tolerance: the power jumps at the recovery instant).',
  }
}

export const DIODE_ANALYSIS: Array<AnalysisCategory<DiodeRun, DiodeMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['irr', 'trr', 'qrr', 'deon'] },
  { id: 'recovery', label: 'Recovery', rows: ['didt', 'tf', 'ta', 'tb', 'trr', 'irr', 'qrr', 'softness'], note: (m, r) => `Stored charge at I0: qM = τ·I0 = ${formatQ(m.qStored)}; recovered Qrr = ${formatQ(m.qrr)}; tail time constant τrr = ${formatTime(r.params.tauRR)}.` },
  { id: 'voltage', label: 'Voltage stress', rows: ['vrm', 'overshoot', 'vf'] },
  { id: 'energy', label: 'Losses', rows: ['eon', 'eon0', 'deon', 'erec'] },
  { id: 'static', label: 'Static I–V', tab: 'iv' },
]

export const DIODE_PARTS = [
  { id: 'vdc', label: 'Source Vdc' },
  { id: 'ls', label: 'Loop inductance Ls' },
  { id: 'diode', label: 'Diode D' },
  { id: 'load', label: 'Load inductor I0' },
  { id: 'switch', label: 'Switch Q' },
]

type L = Lesson<DiodeParams, DiodeRun, DiodeMeasurements, DiodeState>
const zoom = (r: DiodeRun): [number, number] => [r.params.ton - 0.4 * (diodeMeasured(r).tf ?? 0), r.params.tend]

export const DIODE_LESSONS: L[] = [
  {
    id: 'recovery',
    title: 'Why a diode conducts backwards',
    summary: 'Stored charge, the zero crossing, Irr, and the recovered charge Qrr.',
    base: {},
    check: {
      question: 'After its current crosses zero the diode keeps conducting backwards because…',
      options: ['the switch forces it to break down', 'the charge stored in it must be removed before the junction can block', 'the loop inductance stores energy'],
      answer: 1,
      explain: 'A conducting PN diode is full of stored charge. The junction can only block once the charge next to it is gone; until then the reverse current pulls it out. That reverse current peaks at Irr when the junction recovers.',
    },
    steps: [
      {
        title: '1 · Forward conduction stores charge',
        at: (r) => 0.5 * r.params.ton,
        window: zoom,
        channels: ['id', 'qm', 'qe'],
        look: 'The diode carries I0; its base holds a constant charge.',
        body: (st, m, r) => `The diode carries ${formatA(st.id)} at ${formatV(st.vd, false)}. To do so its base holds qM = τ·I0 = ${formatQ(st.qm)} (τ = ${formatTime(r.params.tau)}). In SIMULATION qM = ${formatQ(m.qStored)} at the instant the switch turns on.`,
      },
      {
        title: '2 · The switch takes the current',
        at: (r) => r.params.ton + 0.5 * (diodeMeasured(r).tf ?? 0),
        window: zoom,
        channels: ['iq', 'id', 'qm'],
        look: 'iQ rises, iD falls at the same rate; the charge hardly moves yet.',
        body: (st, m) => `iQ + iD = I0: the switch now carries ${formatA(st.iq)} and the diode ${formatA(st.id)}, falling at ${formatSlope(m.didt ?? NaN)}. The stored charge (${formatQ(st.qm)}) cannot follow that fast.`,
      },
      {
        title: '3 · Zero current — but no blocking',
        at: (r) => {
          const m = diodeMeasured(r)
          return (m.t0 ?? 0) + 0.6 * (m.ta ?? 0)
        },
        window: zoom,
        channels: ['id', 'vd', 'qe'],
        look: 'iD goes negative while vAK stays near zero; qE falls towards zero.',
        body: (st, m) => `iD = ${formatA(st.id)}: the diode conducts BACKWARDS and its voltage is still only ${formatV(st.vd)}. The junction charge qE = ${formatQ(st.qe)} must reach zero first; it happens ${formatTime(m.ta ?? NaN)} after the zero crossing.`,
      },
      {
        title: '4 · Recovery: Irr and the voltage jump',
        at: (r) => (diodeMeasured(r).tRec ?? 0) + 0.3 * r.params.tauRR,
        window: zoom,
        channels: ['id', 'vd', 'iq'],
        look: 'The reverse current peaks; the diode voltage jumps to a large negative value.',
        body: (_st, m, r) => `The junction recovered: the reverse current peaked at Irr = ${formatA(m.irr ?? NaN)} and the diode suddenly blocks — vAK falls to −${formatV(m.vrm, false)}, ${formatV(m.overshoot, false)} beyond Vdc = ${formatV(r.params.vdc, false)}, because Ls·di/dt now adds to Vdc.`,
      },
      {
        title: '5 · The recovered charge Qrr',
        at: (r) => r.params.tend - 1e-15,
        window: zoom,
        channels: ['id', 'qrrn'],
        look: 'Qrr is the area of the negative current pulse.',
        body: (_st, m) => `SIMULATION: Qrr = ${formatQ(m.qrr)} (the area under the reverse current), trr = ${formatTime(m.trr ?? NaN)}. The triangle rule ½·Irr·trr gives ${formatQ(0.5 * (m.irr ?? 0) * (m.trr ?? 0))}.`,
      },
    ],
  },
  {
    id: 'cost',
    title: 'What recovery costs the switch',
    summary: 'The switch carries I0 + Irr at high voltage: the extra turn-on energy.',
    base: {},
    check: {
      question: 'Making the switch turn on faster (larger di/dt) makes the peak reverse current Irr…',
      options: ['larger', 'smaller', 'unchanged'],
      answer: 0,
      explain: 'With a larger di/dt the current reaches zero before much charge has recombined, and more charge must be pulled out faster: Irr grows (roughly with √(di/dt) for an abrupt diode).',
    },
    steps: [
      {
        title: '1 · The current overshoot',
        at: (r) => diodeMeasured(r).tRec ?? r.params.ton,
        window: zoom,
        channels: ['iq', 'id'],
        look: 'The switch current overshoots I0 by Irr.',
        body: (_st, m, r) => `At the peak the switch carries I0 + Irr = ${formatA(m.ipk)} — ${(m.ipk / r.params.i0).toFixed(2)} times the load current — because the diode's reverse current flows through it too.`,
      },
      {
        title: '2 · …at high voltage',
        at: (r) => {
          const m = diodeMeasured(r)
          return (m.t0 ?? 0) + 0.5 * (m.ta ?? 0)
        },
        window: zoom,
        channels: ['iq', 'vq', 'pq'],
        look: 'The switch voltage stays high until the diode recovers.',
        body: (st, m) =>
          m.limit === 'gate'
            ? `The switch voltage is still ${formatV(st.vq, false)}: it cannot fall while the diode conducts, because the diode clamps the switch node to Vdc. The switch dissipates ${formatSI(st.pq, 'W')} now.`
            : `Here the loop inductance limits di/dt, so the switch is already fully on (${formatV(st.vq, false)}). Raise Ls·S above Vdc and the cost moves into the diode and the voltage spike.`,
      },
      {
        title: '3 · The bill: ΔEon',
        at: (r) => r.params.tend - 1e-15,
        window: zoom,
        channels: ['eq', 'pq'],
        look: 'The energy curve steps up most during the reverse current.',
        body: (_st, m) => `SIMULATION: Eon = ${formatSI(m.eon, 'J')}. The same test with a charge-free diode gives ${formatSI(m.eon0, 'J')}: the recovery adds ΔEon = ${formatSI(m.deon, 'J')} (${((m.deon / Math.max(m.eon0, 1e-18)) * 100).toFixed(0)} % more).`,
      },
      {
        title: '4 · A faster switch: larger Irr',
        params: { didt: 3000e6 },
        at: (r) => diodeMeasured(r).tRec ?? r.params.ton,
        window: zoom,
        channels: ['iq', 'id', 'vq'],
        look: 'di/dt is three times larger: compare Irr and ΔEon.',
        body: (_st, m) => `di/dt = ${formatSlope(m.didt ?? NaN)}: Irr = ${formatA(m.irr ?? NaN)}, Qrr = ${formatQ(m.qrr)}, ΔEon = ${formatSI(m.deon, 'J')}. The current reaches zero sooner, so less charge has recombined, and it is pulled out faster.`,
      },
    ],
  },
  {
    id: 'snappy',
    title: 'Soft and snappy recovery',
    summary: 'How fast the tail ends decides the voltage spike.',
    base: {},
    check: {
      question: 'A snappy diode (very short tail) in a circuit with stray inductance gives…',
      options: ['a lower reverse-voltage peak', 'a higher reverse-voltage peak', 'no change in the voltage'],
      answer: 1,
      explain: 'The reverse current must fall from Irr back to zero. Through the loop inductance this costs a voltage Ls·di/dt: the faster it falls (snappy), the higher the spike on top of Vdc.',
    },
    steps: [
      {
        title: '1 · A soft tail',
        at: (r) => (diodeMeasured(r).tRec ?? 0) + r.params.tauRR,
        window: zoom,
        channels: ['id', 'vd'],
        look: 'The reverse current decays smoothly; the voltage overshoot is moderate.',
        body: (_st, m, r) => `T = ${formatTime(r.params.tm)}: the tail time constant is τrr = ${formatTime(r.params.tauRR)}, tb/ta = ${(m.softness ?? NaN).toFixed(2)}. Peak reverse voltage ${formatV(m.vrm, false)}.`,
      },
      {
        title: '2 · A snappy diode',
        params: { tm: 2e-9 },
        at: (r) => (diodeMeasured(r).tRec ?? 0) + r.params.tauRR,
        window: zoom,
        channels: ['id', 'vd'],
        look: 'The current snaps back to zero; the voltage spike grows.',
        body: (_st, m, r) => `T = ${formatTime(r.params.tm)}: τrr = ${formatTime(r.params.tauRR)}, tb/ta = ${(m.softness ?? NaN).toFixed(2)}. The current falls ${formatA(m.irr ?? NaN)} in a few ns, and Ls·di/dt pushes the reverse voltage to ${formatV(m.vrm, false)}.`,
      },
      {
        title: '3 · Less stray inductance',
        params: { tm: 2e-9, ls: 30e-9 },
        at: (r) => (diodeMeasured(r).tRec ?? 0) + r.params.tauRR,
        window: zoom,
        channels: ['id', 'vd'],
        look: 'Same diode, a tighter layout: a smaller spike.',
        body: (_st, m) => `Ls = 30 nH: the same snappy diode now peaks at ${formatV(m.vrm, false)}. That is why fast power stages need a compact commutation loop.`,
      },
    ],
  },
]

export const DIODE_EXPERIMENTS: Array<Experiment<DiodeParams, DiodeMeasurements>> = [
  {
    id: 'didt',
    title: 'Triple the switching speed',
    change: (p) => ({ didt: p.didt * 3 }),
    question: (p) => `The switch di/dt goes from ${formatSlope(p.didt)} to ${formatSlope(p.didt * 3)}. What happens to Irr?`,
    choices: ['It grows', 'It shrinks', 'It stays the same'],
    judge: (b, a) => ((a.irr ?? 0) > (b.irr ?? 0) * 1.02 ? 0 : (a.irr ?? 0) < (b.irr ?? 0) * 0.98 ? 1 : 2),
    rows: ['didt', 'irr', 'ta', 'qrr', 'deon'],
    why: (b, a) => `Irr ${formatA(b.irr ?? NaN)} → ${formatA(a.irr ?? NaN)}, Qrr ${formatQ(b.qrr)} → ${formatQ(a.qrr)}. Faster commutation leaves less time for recombination, so more charge is pulled out — faster. But the switching time itself is shorter: ΔEon ${formatSI(b.deon, 'J')} → ${formatSI(a.deon, 'J')}.`,
  },
  {
    id: 'tau',
    title: 'Double the carrier lifetime',
    change: (p) => ({ tau: p.tau * 2 }),
    question: (p) => `τ goes from ${formatTime(p.tau)} to ${formatTime(p.tau * 2)} (a slower diode). What happens to the recovered charge Qrr?`,
    choices: ['It grows', 'It shrinks', 'It stays the same'],
    judge: (b, a) => (a.qrr > b.qrr * 1.02 ? 0 : a.qrr < b.qrr * 0.98 ? 1 : 2),
    rows: ['qrr', 'irr', 'trr', 'deon'],
    why: (b, a) => `Qrr ${formatQ(b.qrr)} → ${formatQ(a.qrr)}: the stored charge τ·I0 doubles, and a longer lifetime also lets less of it recombine during the fall. Irr ${formatA(b.irr ?? NaN)} → ${formatA(a.irr ?? NaN)}.`,
  },
  {
    id: 'ls',
    title: 'A sloppy layout: five times the loop inductance',
    change: (p) => ({ ls: p.ls * 5 }),
    question: (p) => `Ls goes from ${formatSI(p.ls, 'H')} to ${formatSI(p.ls * 5, 'H')}. What happens to the peak reverse voltage on the diode?`,
    choices: ['It rises', 'It falls', 'It stays the same'],
    judge: (b, a) => (a.vrm > b.vrm * 1.02 ? 0 : a.vrm < b.vrm * 0.98 ? 1 : 2),
    rows: ['vrm', 'didt', 'irr', 'overshoot'],
    why: (b, a) => `Peak reverse voltage ${formatV(b.vrm, false)} → ${formatV(a.vrm, false)}. The tail current still has to fall to zero, and every nanohenry turns that fall into voltage: Ls·di/dt. di/dt ${formatSlope(b.didt ?? NaN)} → ${formatSlope(a.didt ?? NaN)} (the loop now ${a.limit === 'loop' ? 'limits' : 'does not limit'} it).`,
  },
]

export function diodePredictions(seed: number): Array<PredictTask<DiodeParams, DiodeMeasurements>> {
  const i0 = [10, 20, 40][seed % 3]
  const didt = [500e6, 1000e6, 2000e6][(seed + 1) % 3]
  const tau = [20e-9, 25e-9, 50e-9][(seed + 2) % 3]
  return [
    {
      id: 'tf',
      prompt: `I0 = ${i0} A, the switch current rises at ${formatSlope(didt)} (Vdc = 400 V, Ls = 100 nH). How long after turn-on does the diode current reach zero?`,
      params: { i0, didt },
      kind: 'number',
      unit: 's',
      answer: (m) => m.tf ?? NaN,
      tolerance: 0.03,
      hint: 'iQ + iD = I0, and iQ rises at a constant rate.',
      theory: (p) => `t = I0/(di/dt) = ${formatTime(p.i0 / Math.min(p.didt, p.vdc / p.ls))} (the gate sets di/dt: S < Vdc/Ls)`,
    },
    {
      id: 'stored',
      prompt: `Carrier lifetime τ = ${formatTime(tau)}, I0 = 20 A. How much charge is stored in the diode's base while it conducts?`,
      params: { tau, i0: 20 },
      kind: 'number',
      unit: 'C',
      answer: (m) => m.qStored,
      tolerance: 0.03,
      hint: 'In steady state recombination (q/τ) balances the current.',
      theory: (p) => `qM = τ·I0 = ${formatQ(p.tau * p.i0)}`,
    },
    {
      id: 'limit',
      prompt: 'Vdc = 400 V, Ls = 1 µH, the switch could drive 1000 A/µs. Which sets the di/dt of the diode current?',
      params: { ls: 1e-6, didt: 1000e6 },
      kind: 'choice',
      choices: ['The switch (its gate)', 'The loop inductance (Vdc/Ls)'],
      answer: (m) => (m.limit === 'gate' ? 0 : 1),
      hint: 'Compare S with Vdc/Ls: the slower one wins.',
      theory: (p) => `Vdc/Ls = ${formatSlope(p.vdc / p.ls)} < S = ${formatSlope(p.didt)}: the loop limits di/dt, and the switch voltage collapses to Ron·iQ at once.`,
    },
    {
      id: 'vf',
      prompt: 'Shockley diode: Is = 1 nA, n = 1.8, Rs = 10 mΩ, at 25 °C (VT = 25.7 mV). Predict the forward voltage at I0 = 20 A.',
      params: { i0: 20, isat: 1e-9, n: 1.8, rs: 0.01 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vf,
      tolerance: 0.02,
      hint: 'v = n·VT·ln(1 + I/Is) + Rs·I.',
      theory: (p) => `Vf = n·VT·ln(1 + I0/Is) + Rs·I0 = ${formatV(shockleyV(p, p.i0), false)}`,
    },
  ]
}

export { DIODE_DEFAULTS }
