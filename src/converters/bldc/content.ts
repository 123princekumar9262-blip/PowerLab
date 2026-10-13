import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import type { CurrentPath, EnergyModel, NextConsequence, StatusInfo } from '../../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { BLDC_DEFAULTS, lastCycle, measureBldc, PHASES, rpm, SECTORS, simulateBldc, type BldcMeasurements, type BldcParams, type BldcRun } from './model.ts'
import { exactBldc, textbookBldc } from './theory.ts'

export { measureBldc, simulateBldc }

/** Switch and diode names per leg (upper, lower), the usual numbering S1…S6 in firing order. */
export const UPPER = ['S1', 'S3', 'S5']
export const LOWER = ['S4', 'S6', 'S2']
export const D_UP = ['D1', 'D3', 'D5']
export const D_LO = ['D4', 'D6', 'D2']
const PH = ['a', 'b', 'c']

export interface BldcState {
  k: number
  t: number
  i: [number, number, number]
  e: [number, number, number]
  v: [number, number, number]
  vn: number
  te: number
  tav: number
  tl: number
  w: number
  n: number
  theta: number
  sector: number
  hall: [number, number, number]
  gate: boolean
  duty: number
  /** Per leg: 'H' upper gated, 'L' lower gated, 'd' lower diode, 'u' upper diode, 'o' open. */
  legs: string
  nconn: number
  /** The device carrying each leg's current (or null). */
  device: [string | null, string | null, string | null]
  idc: number
  pin: number
  /** Phase still carrying current through a diode after a commutation (three phases conduct), or null. */
  outgoing: number | null
  /** The phase chopped by the PWM (upper switch) and the phase whose lower switch is on. */
  hi: number
  lo: number
  phase: 'start' | 'drive' | 'freewheel' | 'commutating' | 'stopped'
}

export function bldcStateAt(r: BldcRun, k: number): BldcState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const legs = r.legs[i]
  const cur: [number, number, number] = [s.ia[i], s.ib[i], s.ic[i]]
  const device = [0, 1, 2].map((x) => {
    const c = legs[x]
    if (c === 'H') return cur[x] >= 0 ? UPPER[x] : D_UP[x]
    if (c === 'L') return cur[x] <= 0 ? LOWER[x] : D_LO[x]
    if (c === 'd') return D_LO[x]
    if (c === 'u') return D_UP[x]
    return null
  }) as BldcState['device']
  const sector = r.sector[i]
  const sec = SECTORS[sector]
  const nconn = r.nconn[i]
  const outgoing = nconn === 3 && (legs[sec.off] === 'd' || legs[sec.off] === 'u') ? sec.off : null
  const gate = s.gate[i] > 0.5
  const moving = Math.abs(s.w[i]) > 1e-9
  const phase: BldcState['phase'] = outgoing !== null ? 'commutating' : nconn < 2 ? 'stopped' : !moving || (i > 0 && r.time[i] < 0.02 * p.duration && Math.abs(s.n[i]) < 0.05 * Math.abs(s.n[r.length - 1])) ? 'start' : gate ? 'drive' : 'freewheel'
  return {
    k: i,
    t: r.time[i],
    i: cur,
    e: [s.ea[i], s.eb[i], s.ec[i]],
    v: [s.va[i], s.vb[i], s.vc[i]],
    vn: s.vn[i],
    te: s.te[i],
    tav: s.tav[i],
    tl: s.tl[i],
    w: s.w[i],
    n: s.n[i],
    theta: s.theta[i],
    sector,
    hall: [s.ha[i], s.hb[i], s.hc[i]] as [number, number, number],
    gate,
    duty: s.duty[i],
    legs,
    nconn,
    device,
    idc: s.idc[i],
    pin: s.pin[i],
    outgoing,
    hi: sec.hi,
    lo: sec.lo,
    phase,
  }
}

export const hallCode = (h: number[]) => h.join('')
export const pairText = (st: Pick<BldcState, 'hi' | 'lo'>) => `${PH[st.hi]}+ ${PH[st.lo]}−`

const PHASE_TEXT: Record<BldcState['phase'], string> = {
  start: 'starting',
  drive: 'pair driven from Vdc',
  freewheel: 'PWM off: freewheeling',
  commutating: 'commutating',
  stopped: 'no current',
}

/** The conducting loop at the cursor, from the simulated device states. */
export function bldcPath(st: BldcState, r: BldcRun): CurrentPath {
  const p = r.params
  const els: string[] = []
  const parts: string[] = []
  const conducting = [0, 1, 2].filter((x) => st.device[x] !== null)
  for (const x of conducting) els.push(st.device[x]!.toLowerCase(), `ph-${PH[x]}`)
  const into = conducting.filter((x) => st.i[x] > 0)
  const outOf = conducting.filter((x) => st.i[x] < 0)
  parts.push(`${into.map((x) => `${st.device[x]} → phase ${PH[x]}`).join(' + ') || '—'} → neutral → ${outOf.map((x) => `phase ${PH[x]} → ${st.device[x]}`).join(' + ') || '—'}`)
  const reasons: string[] = [`Hall ${hallCode(st.hall)} → sector ${st.sector + 1}: ${UPPER[st.hi]} (phase ${PH[st.hi]} to +) ${p.chop === 'pwm' ? (st.gate ? 'gated (PWM on)' : 'off (PWM off)') : 'gated'}, ${LOWER[st.lo]} (phase ${PH[st.lo]} to −) gated.`]
  if (st.outgoing !== null) reasons.push(`Phase ${PH[st.outgoing]} lost its switch at the last Hall edge; its inductance keeps the current flowing through ${st.device[st.outgoing]} until it reaches zero.`)
  if (p.chop === 'pwm' && !st.gate && st.device[st.hi] === D_LO[st.hi]) reasons.push(`PWM off: phase ${PH[st.hi]}'s current freewheels through ${D_LO[st.hi]} — the pair sees 0 V instead of Vdc.`)
  return { elements: els, text: parts[0], reasons }
}

export function bldcView(st: BldcState, r: BldcRun): StateView {
  const p = r.params
  const devs = [0, 1, 2].map((x) => st.device[x]).filter(Boolean).join(', ') || 'none'
  return {
    badge: { text: PHASE_TEXT[st.phase], tone: st.phase === 'drive' ? 'on' : st.phase === 'stopped' ? 'off' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'speed', v: `${st.n.toFixed(0)} rpm`, tone: 'ok' },
      { k: 'Hall code (a b c)', v: `${hallCode(st.hall)} · sector ${st.sector + 1}` },
      { k: 'conducting pair', v: pairText(st) },
      { k: 'devices conducting', v: devs, tone: 'on-q' },
      { k: 'ia, ib, ic', v: st.i.map((x) => formatA(x, true)).join(', ') },
      { k: 'torque', v: `${st.te.toFixed(3)} N·m` },
      { k: 'back-EMF ea, eb, ec', v: st.e.map((x) => formatV(x)).join(', '), min: 'standard' },
      { k: 'PWM gate', v: p.chop === 'pwm' ? (st.gate ? 'ON' : 'OFF') : 'always on (six-step)', tone: st.gate ? 'on-q' : 'off', min: 'standard' },
      { k: 'rotor angle θe', v: `${st.theta.toFixed(1)}°`, min: 'standard' },
      { k: 'load torque', v: `${st.tl.toFixed(3)} N·m`, min: 'standard' },
      { k: 'torque, PWM-period average', v: `${st.tav.toFixed(3)} N·m`, min: 'engineer' },
      { k: 'neutral voltage vn', v: formatV(st.vn), min: 'engineer' },
      { k: 'DC-link current', v: formatA(st.idc, true), min: 'engineer' },
    ],
    path: bldcPath(st, r).text,
  }
}

export function bldcStatus(st: BldcState, r: BldcRun): StatusInfo {
  const p = r.params
  const head = `Sector ${st.sector + 1} (Hall ${hallCode(st.hall)}) · ${pairText(st)}`
  const facts: string[] = []
  if (st.outgoing !== null) facts.push(`phase ${PH[st.outgoing]} still conducts through ${st.device[st.outgoing]} (commutation)`)
  else facts.push('two phases conduct')
  if (p.chop === 'pwm') facts.push(st.gate ? 'PWM on' : 'PWM off: freewheeling')
  facts.push(`Te ${st.te.toFixed(3)} N·m`)
  return { headline: head, facts, tone: st.phase === 'drive' ? 'on' : st.phase === 'stopped' ? 'off' : 'idle' }
}

/** The next consequence: the run's next Hall edge or commutation end after the cursor (never invented). */
export function bldcNext(r: BldcRun, st: BldcState): NextConsequence | null {
  const t = st.t + 0.5 * r.params.dt
  const e = r.events.find((x) => x.time > t && (x.kind === 'diode-off' || x.device?.startsWith('hall') || x.device === 'load-step' || x.device === 'duty-step'))
  if (!e) return null
  return { text: `${bldcEventLabel(e)} at t = ${formatTime(e.time)}. ${bldcEventWhy(e)}`, time: e.time }
}

export function bldcEventLabel(e: RunEvent): string {
  if (e.device?.startsWith('hall')) {
    const s = e.values.sector ?? 0
    return `Hall edge → ${hallCode(SECTORS[s].hall)}: ${UPPER[SECTORS[s].hi]} + ${LOWER[SECTORS[s].lo]} (${PH[SECTORS[s].hi]}+ ${PH[SECTORS[s].lo]}−)`
  }
  if (e.kind === 'diode-off') return `Commutation complete: phase ${PH[e.values.phase ?? 0]} current reaches zero`
  if (e.device === 'peak') return 'Peak start-up current'
  if (e.device === 'load-step') return 'Load torque step'
  if (e.device === 'duty-step') return 'Duty step'
  return e.device ?? e.kind
}

export function bldcEventWhy(e: RunEvent): string {
  if (e.device?.startsWith('hall')) {
    const s = e.values.sector ?? 0
    const sec = SECTORS[s]
    const up = (e.values.upper ?? 0) > 0.5
    return `The rotor has turned 60° (electrical): the Hall sensors switch to the next pair, whose back-EMFs are flat for the next 60°. Phase ${PH[sec.off]} loses its ${up ? 'upper' : 'lower'} switch, but its inductance keeps its current flowing through ${up ? D_LO[sec.off] : D_UP[sec.off]} until it decays to zero.`
  }
  if (e.kind === 'diode-off') return `${PH[e.values.phase ?? 0]}'s current decayed to zero in ${formatTime(e.values.tc ?? 0)} (SIMULATION): the diode blocks, two phases conduct again and the torque recovers.`
  if (e.device === 'peak') return `At standstill there is no back-EMF: only R and L limit the current (${formatA(e.values.i ?? 0)}). As the rotor gains speed the back-EMF opposes the supply and the current falls.`
  const from = e.values.from ?? 0
  const to = e.values.to ?? 0
  const nB = e.values.nBefore ?? 0
  const nE = e.values.nEnd ?? 0
  const sp = `the speed goes from ${nB.toFixed(0)} to ${nE.toFixed(0)} rpm by the end of the run`
  if (e.device === 'load-step') return `Load torque ${from.toFixed(2)} → ${to.toFixed(2)} N·m: ${to > from ? 'the rotor slows until the lower back-EMF lets enough extra current flow' : 'the rotor speeds up until the higher back-EMF cuts the current back'} — ${sp}.`
  if (e.device === 'duty-step') return `Duty ${(from * 100).toFixed(0)} → ${(to * 100).toFixed(0)} %: the mean pair voltage d·Vdc ${to > from ? 'rises above' : 'falls below'} the line back-EMF 2·ke·ω, so the current ${to > from ? 'grows and the rotor accelerates' : 'collapses and the rotor slows (the diodes cannot brake it)'} — ${sp}.`
  return ''
}

export function bldcWhy(r: BldcRun, st: BldcState, m: BldcMeasurements): WhyCard[] {
  const p = r.params
  const tb = textbookBldc(p)
  const cards: WhyCard[] = []
  const I = Math.abs(st.i[st.hi])
  const E = Math.abs(st.e[st.hi] - st.e[st.lo])
  const now: Record<BldcState['phase'], Omit<WhyCard, 'id' | 'question'>> = {
    start: {
      what: `The rotor is still slow (${st.n.toFixed(0)} rpm): the back-EMF between the conducting phases is only ${formatV(E, false)}.`,
      why: `Two phases in series (2R = ${formatSI(2 * p.r, 'Ω')}) see ${p.chop === 'pwm' ? 'the chopped' : 'the full'} supply with almost nothing opposing it: the current is ${formatA(I)}.`,
      equation: '2L·di/dt = v − 2R·i − 2·ke·ω',
      physics: `The torque 2·ke·i = ${st.te.toFixed(3)} N·m is far above the load: the rotor accelerates.`,
      whatIf: 'A lower duty (soft start) or a current limit keeps the starting current down.',
    },
    drive: {
      what: `${UPPER[st.hi]} and ${LOWER[st.lo]} are on: phases ${PH[st.hi]} and ${PH[st.lo]} carry ${formatA(I)} in series across Vdc = ${formatV(p.vdc, false)}.`,
      why: `The line back-EMF of the pair is ${formatV(E, false)}; the rest of Vdc drives the current up: 2L·di/dt = Vdc − 2R·i − 2ke·ω.`,
      equation: 'Te = ke·(f_a·ia + f_b·ib + f_c·ic) = 2·ke·I  (both EMFs flat)',
      physics: `Both conducting phases are on the flat top of their back-EMF, so the torque is just proportional to the current: ${st.te.toFixed(3)} N·m now.`,
      whatIf: 'If the Hall sensors were misaligned, a phase would conduct on a sloping EMF and the torque would sag.',
    },
    freewheel: {
      what: `PWM off: ${UPPER[st.hi]} is open, phase ${PH[st.hi]}'s current (${formatA(I)}) freewheels through ${D_LO[st.hi]} and ${LOWER[st.lo]}.`,
      why: 'The pair now sees 0 V: only the back-EMF and R act on the current, so it falls until the next PWM pulse.',
      equation: '2L·di/dt = 0 − 2R·i − 2·ke·ω  (falling)',
      physics: `Averaged over a PWM period the pair sees d·Vdc = ${formatV(st.duty * p.vdc, false)}: that is how the duty controls the speed.`,
      whatIf: 'A higher PWM frequency or more inductance makes the current fall less in each off-time.',
    },
    commutating: {
      what: `Hall edge just passed: phase ${PH[st.outgoing ?? 0]} lost its switch but still carries ${formatA(Math.abs(st.i[st.outgoing ?? 0]))} through ${st.device[st.outgoing ?? 0]}. Three phases conduct.`,
      why: 'The inductance will not let the outgoing current stop at once: it decays through the diode while the incoming phase builds up. The two rates are different, so the current of the third (common) phase — and the torque — changes.',
      equation: 'L·d|ic|/dt = (d·Vdc − 4E)/3 − R·I  (upper commutation, common phase c)',
      physics: `The torque is ${st.te.toFixed(3)} N·m now; over the last cycle it swung by ${(m.ripple * 100).toFixed(0)} % of its mean (SIMULATION).`,
      whatIf: 'The rates would match only if the commutation were driven with 4E + 3RI — about twice what the steady state needs. Current-controlled drives apply the full Vdc during the commutation to shrink the dip at low speed; a larger L only stretches it.',
    },
    stopped: {
      what: 'No phase carries current: the chopped phase\'s current reached zero during the PWM off-time.',
      why: 'The back-EMF exceeds the applied voltage: no path lets current flow until the next PWM pulse.',
      equation: 'i = 0',
      physics: 'Discontinuous conduction: the torque is zero for this moment.',
      whatIf: 'More load torque (more current) or a higher duty restores continuous conduction.',
    },
  }
  cards.push({ id: 'now', question: `What is happening now? (${PHASE_TEXT[st.phase]})`, ...now[st.phase] })
  cards.push({
    id: 'hall',
    question: 'Why only two phases, and why switch every 60°?',
    what: `Hall code ${hallCode(st.hall)} (sector ${st.sector + 1}) selects ${UPPER[st.hi]} and ${LOWER[st.lo]}: phase ${PH[st.hi]} to +, phase ${PH[st.lo]} to −, phase ${PH[SECTORS[st.sector].off]} off.`,
    why: 'Each trapezoidal back-EMF is flat for 120°. The Hall sensors switch the current into exactly the two phases whose EMFs are flat (one at +ke·ω, one at −ke·ω): the torque is then constant, 2·ke·I.',
    equation: 'Te = (ea·ia + eb·ib + ec·ic)/ω = ke·(+1·I + (−1)·(−I)) = 2·ke·I',
    physics: 'Three sensors, 180° wide and 120° apart, give six codes: one per 60° sector, never 000 or 111.',
    whatIf: 'Sinusoidal back-EMF machines (PMSM) are driven instead with sinusoidal currents and field-oriented control.',
  })
  cards.push({
    id: 'speed',
    question: 'Why does the motor settle at this speed?',
    what: `SIMULATION: ${m.nEnd.toFixed(0)} rpm, mean torque ${m.teMean.toFixed(3)} N·m${m.settled ? '' : ' — not yet settled at the end of the run'}.`,
    why: 'The speed rises until the line back-EMF 2·ke·ω plus the drop 2·R·I in the two conducting phases uses up the mean voltage d·Vdc.',
    equation: 'd·Vdc = 2·ke·ω + 2·R·I,   2·ke·I = TL + B·ω',
    physics: `Textbook: ${rpm(tb.w).toFixed(0)} rpm. The simulation is lower because at every commutation the outgoing current and the torque dip; to carry the same mean torque the current between commutations is higher, which costs more R drop (and the commutation itself takes voltage-seconds).`,
    whatIf: 'Halving the duty roughly halves the speed; doubling the load adds 2·R·ΔI of drop.',
  })
  cards.push({
    id: 'ripple',
    question: 'Why does the torque dip at each commutation?',
    what: `SIMULATION: the ${p.chop === 'pwm' ? 'PWM-period-averaged ' : ''}torque swings by ${(m.ripple * 100).toFixed(0)} % of its mean; a commutation takes ${m.tcUp === null ? '—' : formatTime(m.tcUp)} (upper) / ${m.tcLow === null ? '—' : formatTime(m.tcLow)} (lower).`,
    why: 'During a commutation the outgoing phase is clamped by a diode, the incoming one is driven from the supply. Unless the two currents change at the same rate, the current of the third phase — which alone sets the torque then — rises or falls.',
    equation: `upper: ΔT/T = (d·Vdc − 4E)/(d·Vdc + 2E) = ${(tb.dipUp * 100).toFixed(0)} %,  lower: (2d·Vdc − Vdc − 4E)/((2 − d)·Vdc + 2E) = ${(tb.dipLow * 100).toFixed(0)} %`,
    physics: `E = ke·ω = ${formatV(tb.e, false)} (textbook speed). These textbook values neglect R and the sloping EMF of the outgoing phase; the exact theory (Analyze) includes both.`,
    whatIf: 'With this open-loop duty the steady state needs d·Vdc ≈ 2E + 2RI, so the common-phase current always falls during a commutation: the torque dips (≈ −50 % at light load, where E ≈ d·Vdc/2). The ripple is heard as noise and vibration at 6× the electrical frequency.',
  })
  if (m.iPeak > 2 * m.iPeakCycle)
    cards.push({
      id: 'inrush',
      question: 'Why is the starting current so large?',
      what: `SIMULATION: the current peaks at ${formatA(m.iPeak)}, against ${formatA(m.iPeakCycle)} when running.`,
      why: `At rest there is no back-EMF: only 2R = ${formatSI(2 * p.r, 'Ω')} and 2L limit the current of the pair.`,
      equation: `ī ≈ d·Vdc/(2R) = ${formatA((p.duties[0] * p.vdc) / (2 * p.r))}`,
      physics: `The electrical time constant L/R = ${formatTime(p.tauE)} is shorter than the mechanical one J·R/(2ke²) = ${formatTime(p.tauM)}: the current rises before the rotor moves much.`,
      whatIf: 'A ramped duty or a current limit keeps the peak down.',
    })
  return cards
}

/** Tolerances: tight for six-step (the exact theory is the same model at frozen speed); with PWM chopping the
 * theory averages the chopped switch, and its error scales with the PWM period against the commutation time. */
export function bldcTolerances(r: BldcRun, m: BldcMeasurements) {
  const p = r.params
  const d = p.duties[p.periods - 1]
  const pwm = p.chop === 'pwm' && d < 1
  const tc = Math.max(1e-12, Math.min(m.tcUp ?? Infinity, m.tcLow ?? Infinity))
  const k = pwm ? p.period / tc : 0
  return {
    pwm,
    ratio: k,
    speed: pwm ? 0.01 : 0.002,
    mean: pwm ? 0.01 : 0.005,
    rms: pwm ? 0.02 : 0.005,
    ripple: pwm ? Math.max(0.03, 0.3 * k) : 0.02,
    tc: pwm ? Math.max(0.01, 0.1 * k) : 0.005,
  }
}

/** SIMULATION vs THEORY (exact frozen-speed solution) and the textbook formulas. */
export function compareBldc(r: BldcRun, m: BldcMeasurements): CompareResult {
  const p = r.params
  const ex = exactBldc(p)
  const tb = textbookBldc(p)
  const tol = bldcTolerances(r, m)
  const rows: CompareRow[] = []
  const unsettled = !m.settled
    ? 'the run has not settled: the speed is still changing at the end'
    : m.dcm
      ? "discontinuous current: at this light load the chopped phase's current stops during the PWM off-times, which the averaged-switch theory cannot represent (the speed rises above it, as in a DC chopper drive)"
      : null
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tbv: number | null, formula: string, notes: string[], tolerance: number, expected?: string) => {
    if (sim === null || exact === null || !Number.isFinite(sim) || !Number.isFinite(exact)) return
    const error = Math.abs(sim - exact) / Math.max(Math.abs(exact), 1e-30)
    const textbook: TextbookValue | null = tbv === null ? null : { key, value: tbv, formula, assumptions: notes }
    rows.push({ key, label, unit, sim, exact, error, tolerance, pass: error <= tolerance, textbook, textbookError: tbv !== null ? (sim - tbv) / Math.max(Math.abs(tbv), 1e-30) : null, expected: expected ?? (unsettled ?? undefined) })
  }
  const avg = 'textbook: two phases carry I, flat back-EMFs, instant commutation'
  const comm = 'textbook commutation: R neglected, back-EMFs frozen at their flat values, chopping averaged'
  add('nEnd', 'Speed (mean over the last electrical cycle)', 'rpm', m.nEnd, rpm(ex.w), rpm(tb.w), 'ω = (d·Vdc − R·TL/ke)/(2·ke + R·B/ke)', [avg], tol.speed)
  add('idcMean', 'DC-link current (mean)', 'A', m.idcMean, ex.idc, tb.i * p.duties[p.periods - 1], 'ī_dc = d·I', [avg], tol.mean)
  add('iPair', 'Pair current I = ī_dc/d', 'A', m.iPair, ex.iPair, tb.i, 'I = (TL + B·ω)/(2·ke)  (torque constant 2·ke)', [avg], tol.mean)
  add('irms', 'Phase current (RMS)', 'A', m.irms, ex.irms, tb.i * Math.sqrt(2 / 3), 'I·√(2/3)  (120° blocks)', [avg], tol.rms)
  add('ripple', tol.pwm ? 'Torque ripple (PWM-period average), (max − min)/mean' : 'Torque ripple (max − min)/mean', '%', m.ripple, ex.ripple, tb.ripple, 'max(|ΔT/T| upper, lower)', [comm], tol.ripple)
  add('tcUp', 'Commutation time (upper switch changes)', 's', m.tcUp, ex.tcUp, tb.tcUp, 'tc = 3·L·I/(d·Vdc + 2E)', [comm], tol.tc)
  add('tcLow', 'Commutation time (lower switch changes)', 's', m.tcLow, ex.tcLow, tb.tcLow, 'tc = 3·L·I/((2 − d)·Vdc + 2E)', [comm], tol.tc)
  // the torque step over a commutation: instantaneous values, so with PWM they carry the switching ripple
  const pwmNoise = tol.pwm ? 'the instantaneous torque at the two instants carries the PWM current ripple (±ke·ΔI), which the averaged-switch theory leaves out' : undefined
  const dipTol = 0.01
  for (const [key, label, sim, exact, tbv, formula] of [
    ['dipUp', 'Torque step over an upper commutation ΔT/T', m.dipUp, ex.dipUp, tb.dipUp, 'ΔT/T = (d·Vdc − 4E)/(d·Vdc + 2E)'],
    ['dipLow', 'Torque step over a lower commutation ΔT/T', m.dipLow, ex.dipLow, tb.dipLow, 'ΔT/T = (2d·Vdc − Vdc − 4E)/((2 − d)·Vdc + 2E)'],
  ] as const) {
    if (sim === null || exact === null || !Number.isFinite(exact)) continue
    // a step that can be near zero: compared in absolute terms (as a fraction of the torque)
    const e = Math.abs(sim - exact)
    rows.push({ key, label, unit: '%', sim, exact, error: e, tolerance: dipTol, pass: e <= dipTol, absolute: true, textbook: { key, value: tbv, formula, assumptions: [comm] }, textbookError: (sim - tbv) / Math.max(Math.abs(tbv), 1e-30), expected: pwmNoise ?? unsettled ?? undefined })
  }
  return {
    rows,
    allPass: rows.every((x) => x.pass || !!x.expected),
    header: `SIMULATION: RK4 of the inverter and machine (speed free), every Hall edge and diode turn-on/off located. THEORY: the same phase equations at the simulated cycle's frozen speed solved exactly (matrix exponential), periodic orbit by Newton, speed from the torque balance${tol.pwm ? '; the chopped switch is replaced by its mean d·Vdc, so the PWM ripple is not in the theory: tolerances grow with Ts/tc = ' + tol.ratio.toFixed(2) : ''}.`,
    note: ex.converged ? undefined : 'The exact periodic orbit did not converge: theory values are approximate.',
  }
}

export function bldcEnergy(st: BldcState, m: BldcMeasurements, r: BldcRun): EnergyModel {
  const p = r.params
  const pcu = p.r * (st.i[0] ** 2 + st.i[1] ** 2 + st.i[2] ** 2)
  const pem = st.e[0] * st.i[0] + st.e[1] * st.i[1] + st.e[2] * st.i[2]
  // power into the phase inductances = Σ (vx − vn − R·ix − ex)·ix
  const pl = [0, 1, 2].reduce((a, x) => a + (st.v[x] - st.vn - p.r * st.i[x] - st.e[x]) * st.i[x], 0)
  const pfr = p.b * st.w * st.w
  const pload = st.tl * st.w
  const pkin = pem - pfr - pload
  const ledger = [
    { id: 'src', label: 'DC supply', watts: -st.pin, note: 'Vdc·idc (− = supplying)' },
    { id: 'r', label: 'Winding resistance', watts: pcu, note: 'R·(ia² + ib² + ic²) as heat' },
    { id: 'l', label: 'Winding inductance', watts: pl, note: 'stores ½·L·Σi² (+ storing, − releasing)' },
    { id: 'rotor', label: 'Rotor (kinetic energy)', watts: pkin, note: 'Te·ω − B·ω² − TL·ω (+ accelerating)' },
    { id: 'fr', label: 'Friction', watts: pfr, note: 'B·ω²' },
    { id: 'load', label: 'Load', watts: pload, note: 'TL·ω' },
  ]
  const ekin = 0.5 * p.j * st.w * st.w
  const emag = 0.5 * p.l * (st.i[0] ** 2 + st.i[1] ** 2 + st.i[2] ** 2)
  const ekMax = 0.5 * p.j * Math.max(...r.signals.w.map((w) => w * w))
  const emMax = 0.5 * p.l * m.iPeak ** 2 * 2
  return {
    ledger,
    stores: [
      { id: 'rotor', label: 'Rotor ½·J·ω²', joules: ekin, fraction: ekin / Math.max(ekMax, 1e-15), detail: `${pkin >= 0 ? 'gaining' : 'losing'} ${formatW(Math.abs(pkin))}` },
      { id: 'l', label: 'Windings ½·L·Σi²', joules: emag, fraction: Math.min(1, emag / Math.max(emMax, 1e-15)), detail: `${pl >= 0 ? 'storing' : 'releasing'} ${formatW(Math.abs(pl))}` },
    ],
    balance: ledger.reduce((a, x) => a + x.watts, 0),
    tolerance: 1e-6 * Math.max(1e-9, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9,
    summary: `Over the last cycle: ${formatW(m.pin)} from the supply, ${formatW(m.pcu)} copper loss, ${formatW(m.pshaft)} to the load${m.eff !== null ? ` — efficiency ${(m.eff * 100).toFixed(1)} %` : ''} (SIMULATION).`,
  }
}

export function bldcReadings(m: BldcMeasurements, r: BldcRun): Reading[] {
  return [
    { id: 'n', label: 'Speed', value: m.nEnd.toFixed(0), unit: 'rpm', note: 'd·Vdc = 2·ke·ω + 2·R·I' },
    { id: 'ripple', label: r.params.chop === 'pwm' ? 'Torque ripple (PWM-averaged)' : 'Torque ripple', value: (m.ripple * 100).toFixed(0), unit: '%', note: 'dips at every commutation, 6 per cycle' },
    { id: 'te', label: 'Torque, mean', value: m.teMean.toFixed(3), unit: 'N·m', note: 'Te = 2·ke·I between commutations' },
    { id: 'tc', label: 'Commutation time', value: m.tcUp === null ? '—' : (m.tcUp * 1e6).toFixed(0), unit: 'µs', note: 'outgoing current → 0 through a diode', min: 'standard' },
  ]
}

// ── Lessons, experiments, predictions ─────────────────────────────────────────

type L = Lesson<BldcParams, BldcRun, BldcMeasurements, BldcState>

/** The last whole electrical cycle (or the end of the run). */
const cycleWindow = (r: BldcRun): [number, number] => {
  const c = lastCycle(r)
  return c ? [c[0].t, c[1].t] : [0.8 * r.params.duration, r.params.duration]
}
/** A time well inside sector k of the last cycle (after its commutation): two phases conduct. */
const midSector = (r: BldcRun, k = 1) => {
  const c = lastCycle(r)
  if (!c) return r.params.duration - 0.5 * r.params.period
  const hs = r.halls.filter((h) => h.dir > 0 && h.t >= c[0].t - 1e-12 && h.t <= c[1].t + 1e-12)
  const j = Math.min(k, hs.length - 2)
  return j >= 0 ? hs[j].t + 0.75 * (hs[j + 1].t - hs[j].t) : 0.5 * (c[0].t + c[1].t)
}
/** A commutation of the given type in the last cycle. */
const commIn = (r: BldcRun, upper: boolean) => {
  const [a, b] = cycleWindow(r)
  return r.comms.find((c) => c.tHall >= a && c.tHall < b && c.upper === upper && c.tEnd !== null) ?? r.comms.filter((c) => c.tEnd !== null).pop()
}

export const BLDC_LESSONS: L[] = [
  {
    id: 'sixstep',
    title: 'Six-step commutation',
    summary: 'Hall sensors pick two phases at a time: quasi-square currents on flat back-EMFs.',
    check: {
      question: 'Between two commutations, how many phases of a BLDC motor carry current?',
      options: ['one', 'two, in series', 'all three'],
      answer: 1,
      explain: 'Each Hall sector turns on one upper and one lower switch: two phases in series carry the same current I, the third is off. Each phase conducts for 120° positive and 120° negative per electrical cycle.',
    },
    base: { chop: 'none', event: 'none' },
    steps: [
      {
        title: '1 · The Hall sensors cut the cycle into six sectors',
        at: (r) => midSector(r, 1),
        window: (r) => cycleWindow(r),
        channels: ['ha', 'hb', 'hc', 'theta'],
        look: 'Three square waves, each high for 180°, shifted by 120°: one bit changes every 60°.',
        body: (st, m) => `One electrical cycle (SIMULATION: ${formatTime(m.cycleT)} at ${m.nEnd.toFixed(0)} rpm). The rotor is now at θe = ${st.theta.toFixed(0)}°: Hall code ${hallCode(st.hall)}, sector ${st.sector + 1}. Each code selects one upper and one lower switch — here ${UPPER[st.hi]} and ${LOWER[st.lo]}.`,
      },
      {
        title: '2 · Quasi-square phase currents',
        at: (r) => midSector(r, 2),
        window: (r) => cycleWindow(r),
        channels: ['ia', 'ib', 'ic'],
        look: 'Each phase: 120° positive, 60° zero, 120° negative, 60° zero — with short ramps at the commutations.',
        body: (st, m) => `Now ${pairText(st)}: ${formatA(Math.abs(st.i[st.hi]))} flows in through phase ${PH[st.hi]} and out through phase ${PH[st.lo]}. RMS phase current ${formatA(m.irms)} (SIMULATION).`,
      },
      {
        title: '3 · Current on the flat of the back-EMF',
        at: (r) => midSector(r, 1),
        window: (r) => cycleWindow(r),
        channels: ['ea', 'ia', 'eb', 'ib'],
        look: 'Phase a carries current exactly while its trapezoidal EMF is flat at +ke·ω (and at −ke·ω).',
        body: (st, _m, r) => `The flat tops are ke·ω = ${formatV(r.params.ke * st.w, false)} wide 120°. While both conducting phases sit on a flat top, their EMFs add to 2·ke·ω = ${formatV(2 * r.params.ke * st.w, false)} against the supply.`,
      },
      {
        title: '4 · Constant torque Te = 2·ke·I',
        at: (r) => midSector(r, 3),
        window: (r) => cycleWindow(r),
        channels: ['te', 'tl', 'n'],
        look: 'The torque is flat between commutations and dips at each of the six Hall edges.',
        body: (st, m, r) => `Between commutations Te = 2·ke·I = 2 × ${r.params.ke} × ${formatA(Math.abs(st.i[st.hi]))} = ${(2 * r.params.ke * Math.abs(st.i[st.hi])).toFixed(3)} N·m (SIMULATION: ${st.te.toFixed(3)} N·m). Mean over the cycle ${m.teMean.toFixed(3)} N·m = load ${r.params.tl} N·m + friction.`,
      },
    ],
  },
  {
    id: 'commutation',
    title: 'Commutation torque ripple',
    summary: 'Zoom into one commutation: three phases conduct for a moment and the torque dips.',
    check: {
      question: 'During a commutation the outgoing phase current…',
      options: ['stops instantly when its switch opens', 'decays through a freewheeling diode while the incoming phase builds up', 'reverses direction'],
      answer: 1,
      explain: 'The phase inductance will not let the current stop at once: it flows on through the opposite diode until it reaches zero. Meanwhile the incoming phase rises at a different rate, so the third phase current — and the torque — dips (or peaks).',
    },
    base: { chop: 'none', event: 'none' },
    steps: [
      {
        title: '1 · A Hall edge: one switch hands over to another',
        at: (r) => (commIn(r, true)?.tHall ?? 0) + 0.3 * ((commIn(r, true)?.tEnd ?? 0) - (commIn(r, true)?.tHall ?? 0)),
        window: (r) => {
          const c = commIn(r, true)
          const s = (Math.PI / 3) / (r.params.pp * Math.max(Math.abs(r.signals.w[r.length - 1]), 1))
          return c ? [c.tHall - 0.4 * s, c.tHall + 0.6 * s] : [0, r.params.duration]
        },
        channels: ['ia', 'ib', 'ic', 'te'],
        look: 'At the edge: the outgoing phase ramps down, the incoming one ramps up, the third phase carries their sum.',
        body: (st) => `${st.outgoing !== null ? `Phase ${PH[st.outgoing]} has lost its switch but still carries ${formatA(Math.abs(st.i[st.outgoing]))} through ${st.device[st.outgoing]}.` : 'The commutation is over.'} For this moment three phases conduct (ia + ib + ic = 0 still holds at the star point).`,
      },
      {
        title: '2 · The torque dips',
        at: (r) => (commIn(r, true)?.tEnd ?? 0) + 1.5 * r.params.dt,
        window: (r) => {
          const c = commIn(r, true)
          const s = (Math.PI / 3) / (r.params.pp * Math.max(Math.abs(r.signals.w[r.length - 1]), 1))
          return c ? [c.tHall - 0.4 * s, c.tHall + 0.6 * s] : [0, r.params.duration]
        },
        channels: ['te', 'ia', 'ib', 'ic'],
        look: 'The torque reaches its lowest value just as the outgoing current reaches zero.',
        body: (st, m) => `Commutation over in ${m.tcUp === null ? '—' : formatTime(m.tcUp)} (SIMULATION). Torque now ${st.te.toFixed(3)} N·m against a mean of ${m.teMean.toFixed(3)} N·m: over the cycle it swings by ${(m.ripple * 100).toFixed(0)} %.`,
      },
      {
        title: '3 · Why: two different rates',
        at: (r) => (commIn(r, true)?.tHall ?? 0) + 0.5 * ((commIn(r, true)?.tEnd ?? 0) - (commIn(r, true)?.tHall ?? 0)),
        window: (r) => {
          const c = commIn(r, true)
          const s = (Math.PI / 3) / (r.params.pp * Math.max(Math.abs(r.signals.w[r.length - 1]), 1))
          return c ? [c.tHall - 0.2 * s, c.tHall + 0.4 * s] : [0, r.params.duration]
        },
        channels: ['va', 'vb', 'vc', 'vn'],
        look: 'The outgoing phase is clamped to a rail by its diode; the neutral voltage jumps.',
        body: (_st, m, r) => {
          const E = r.params.ke * m.wEnd
          const I = m.iPair
          return `With E = ke·ω = ${formatV(E, false)}, Vdc = ${formatV(r.params.vdc, false)} and R·I = ${formatV(r.params.r * I, false)}: the outgoing current falls at about (Vdc + 2E)/(3L), the incoming one rises at about 2(Vdc − E)/(3L) — different rates. The common phase changes at ((Vdc − 4E)/3 − R·I)/L = ${formatSI(((r.params.vdc - 4 * E) / 3 - r.params.r * I) / r.params.l, 'A/s')}: the SIMULATED torque ${(m.dipUp ?? 0) < 0 ? 'dips' : 'rises'} by ${Math.abs((m.dipUp ?? 0) * 100).toFixed(0)} % over the commutation.`
        },
      },
    ],
  },
  {
    id: 'speed',
    title: 'Speed control by PWM chopping',
    summary: 'Chopping the upper switch sets the mean voltage d·Vdc — and the speed.',
    check: {
      question: 'The duty of the chopped switch drops from 80 % to 50 %. The speed…',
      options: ['falls, roughly in proportion to the duty', 'stays the same', 'rises'],
      answer: 0,
      explain: 'The pair sees d·Vdc on average; the speed settles where 2·ke·ω + 2·R·I uses up d·Vdc, so it follows the duty (a little more than proportionally, because the R drop stays).',
    },
    base: { chop: 'pwm', event: 'duty', duty: 0.8, d2: 0.5 },
    steps: [
      {
        title: '1 · Start-up: a large inrush current',
        at: (r) => r.events.find((e) => e.device === 'peak')?.time ?? 0,
        window: (r) => [0, Math.min(r.params.duration, 3 * (measureBldc(r).t90 ?? r.params.duration / 4))],
        channels: ['n', 'ia', 'ib', 'ic'],
        look: 'The current shoots up while the rotor is still at rest, then falls as the speed builds up.',
        body: (_st, m, r) => `Peak ${formatA(m.iPeak)} (SIMULATION): at rest only 2R = ${formatSI(2 * r.params.r, 'Ω')} limits the current of the pair; d·Vdc/(2R) = ${formatA((r.params.duty * r.params.vdc) / (2 * r.params.r))}.`,
      },
      {
        title: '2 · PWM on the upper switch',
        at: (r) => (r.params.tstep ?? r.params.duration) - 0.5 * (cycleWindow(r)[1] - cycleWindow(r)[0]) / 6,
        window: (r) => {
          const t = (r.params.tstep ?? r.params.duration) - 0.5 * (cycleWindow(r)[1] - cycleWindow(r)[0]) / 6
          return [t - 5 * r.params.period, t + 5 * r.params.period]
        },
        channels: ['gate', 'va', 'vb', 'vc', 'ia'],
        look: 'The chopped phase jumps between Vdc and 0 V; the current ripples around its mean.',
        body: (st, _m, r) => `The upper switch ${UPPER[st.hi]} is chopped at ${formatSI(r.params.fs, 'Hz')} with d = ${(st.duty * 100).toFixed(0)} %. While it is off the current freewheels through ${D_LO[st.hi]}: the pair sees d·Vdc = ${formatV(st.duty * r.params.vdc, false)} on average.`,
      },
      {
        title: '3 · Lower duty, lower speed',
        at: (r) => r.params.duration - 0.5 * r.params.period,
        window: (r) => [0, r.params.duration],
        channels: ['n', 'duty', 'te'],
        look: 'After the duty step the speed falls to a new, lower plateau.',
        body: (_st, m) => `Speed ${m.wPre === null ? '—' : rpm(m.wPre).toFixed(0)} rpm at the first duty, ${m.nEnd.toFixed(0)} rpm after the step (SIMULATION). The torque briefly collapses: the back-EMF is above the new mean voltage and the diodes cannot let the current reverse — the motor coasts down until the current flows again.`,
      },
    ],
  },
]

export const BLDC_EXPERIMENTS: Array<Experiment<BldcParams, BldcMeasurements>> = [
  {
    id: 'load',
    title: 'Double the load torque',
    change: (p) => ({ tl: Math.max(0.05, 2 * p.tl) }),
    question: (p) => `The load torque goes from ${p.tl} to ${Math.max(0.05, 2 * p.tl)} N·m. What happens?`,
    choices: ['The current about doubles; the speed drops only a little', 'The speed halves; the current stays the same', 'Nothing changes'],
    judge: (b, a) => (a.iPair / b.iPair > 1.5 && a.wEnd / b.wEnd > 0.7 ? 0 : a.wEnd / b.wEnd < 0.6 ? 1 : 2),
    rows: ['nEnd', 'iPair', 'ripple'],
    why: (b, a) => `Pair current ${formatA(b.iPair)} → ${formatA(a.iPair)}, speed ${b.nEnd.toFixed(0)} → ${a.nEnd.toFixed(0)} rpm (SIMULATION). The torque 2·ke·I must carry the load, so the current follows it; the speed only loses the extra 2·R·ΔI that is no longer available as back-EMF — and a little more, because the longer commutations at higher current cost torque.`,
  },
  {
    id: 'duty',
    title: 'Halve the duty',
    change: (p) => ({ chop: 'pwm', duty: p.duty / 2 }),
    question: (p) => `The duty goes from ${(p.duty * 100).toFixed(0)} % to ${(p.duty * 50).toFixed(0)} %. What happens to the speed?`,
    choices: ['It roughly halves', 'It stays the same', 'It doubles'],
    judge: (b, a) => (a.wEnd / b.wEnd > 0.3 && a.wEnd / b.wEnd < 0.7 ? 0 : a.wEnd / b.wEnd < 1.3 ? 1 : 2),
    rows: ['nEnd', 'iPair', 'idcMean'],
    why: (b, a) => `Speed ${b.nEnd.toFixed(0)} → ${a.nEnd.toFixed(0)} rpm (SIMULATION): the pair's mean voltage d·Vdc halves and the back-EMF follows it. The pair current hardly changes (${formatA(b.iPair)} → ${formatA(a.iPair)}) — it is set by the load — but the DC-link current halves (${formatA(b.idcMean)} → ${formatA(a.idcMean)}): the power drawn is d·Vdc·I.`,
  },
  {
    id: 'inductance',
    title: 'Four times the phase inductance',
    change: (p) => ({ l: 4 * p.l }),
    question: () => 'L is multiplied by four. What happens to the commutation time?',
    choices: ['It grows about four times', 'It stays the same', 'It shrinks'],
    judge: (b, a) => ((a.tcUp ?? 0) / Math.max(b.tcUp ?? 1, 1e-12) > 2.5 ? 0 : (a.tcUp ?? 0) / Math.max(b.tcUp ?? 1, 1e-12) > 0.8 ? 1 : 2),
    rows: ['tcUp', 'tcLow', 'ripple', 'nEnd'],
    why: (b, a) => `Upper commutation ${b.tcUp === null ? '—' : formatTime(b.tcUp)} → ${a.tcUp === null ? '—' : formatTime(a.tcUp)}, torque ripple ${(b.ripple * 100).toFixed(0)} % → ${(a.ripple * 100).toFixed(0)} % (SIMULATION). The outgoing current decays at a rate set by the voltages over L: tc = 3·L·I/(d·Vdc + 2E) grows with L. The torque dip lasts longer, and the current recovers more slowly afterwards (L/R grows too).`,
  },
]

export function bldcPredictions(seed: number): Array<PredictTask<BldcParams, BldcMeasurements>> {
  const vdc = [12, 24, 36][seed % 3]
  const tl = [0.1, 0.15, 0.2][(seed + 1) % 3]
  return [
    {
      id: 'noload',
      prompt: `Six-step at Vdc = ${vdc} V (no chopping), ke = 0.03 V·s/rad per phase, no load (TL = 0). Predict the speed.`,
      params: { chop: 'none', vdc, tl: 0, event: 'none' },
      kind: 'number',
      unit: 'rpm',
      answer: (m) => m.nEnd,
      tolerance: 0.03,
      hint: 'At no load the line back-EMF of the conducting pair, 2·ke·ω, equals the voltage across the pair, Vdc.',
      theory: (p) => `ω ≈ Vdc/(2·ke) = ${(p.vdc / (2 * p.ke)).toFixed(1)} rad/s = ${rpm(p.vdc / (2 * p.ke)).toFixed(0)} rpm (slightly less: friction needs a little current)`,
    },
    {
      id: 'current',
      prompt: `Load torque ${tl} N·m, ke = 0.03 V·s/rad per phase. Predict the current of the conducting pair, I = ī_dc/d.`,
      params: { tl, event: 'none' },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.iPair,
      tolerance: 0.12,
      hint: 'Two phases on flat back-EMFs: Te = 2·ke·I must carry the load.',
      theory: (p) => `I ≈ TL/(2·ke) = ${formatA(p.tl / (2 * p.ke))} — the simulation is a few % lower: during each commutation the supply feeds only the incoming phase`,
    },
    {
      id: 'hall',
      prompt: `Six-step at Vdc = ${vdc} V, no load, 4 pole pairs. Predict the frequency of each Hall signal.`,
      params: { chop: 'none', vdc, tl: 0, event: 'none' },
      kind: 'number',
      unit: 'Hz',
      answer: (m) => m.fe,
      tolerance: 0.03,
      hint: 'One Hall cycle per electrical revolution: fe = p·n/60, with the no-load speed from Vdc = 2·ke·ω.',
      theory: (p) => `fe = p·ω/(2π) ≈ ${p.pp} × ${(p.vdc / (2 * p.ke)).toFixed(1)}/(2π) = ${((p.pp * p.vdc) / (2 * p.ke) / (2 * Math.PI)).toFixed(1)} Hz`,
    },
    {
      id: 'dip',
      prompt: 'Six-step at Vdc = 24 V, load 0.1 N·m: over a commutation, what does the torque do?',
      params: { chop: 'none', vdc: 24, tl: 0.1, event: 'none' },
      kind: 'choice',
      choices: ['It dips', 'It rises', 'It stays the same'],
      answer: (m) => (Math.abs(m.dipUp ?? 0) < 0.02 ? 2 : (m.dipUp ?? 0) < 0 ? 0 : 1),
      hint: 'Compare Vdc with 4·E, E = ke·ω — at light load E ≈ Vdc/2.',
      theory: (p) => {
        const w = (p.vdc - (p.r * p.tl) / p.ke) / (2 * p.ke + (p.r * p.b) / p.ke)
        const E = p.ke * w
        return `E ≈ ke·ω = ${formatV(E, false)}, 4E = ${formatV(4 * E, false)} ${4 * E > p.vdc ? '> Vdc' : '< Vdc'}: ΔT/T ≈ (Vdc − 4E)/(Vdc + 2E) = ${(((p.vdc - 4 * E) / (p.vdc + 2 * E)) * 100).toFixed(0)} % (R neglected)`
      },
    },
  ]
}

export { BLDC_DEFAULTS, PHASES }
