import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { DRIVE_DEFAULTS, gateAt, loadAt, measureDrive, rpm, simulateDrive, type DriveMeasurements, type DriveParams, type DriveRun } from './motor.ts'
import { averagedDrive, exactDrive } from './theory.ts'

export { measureDrive, simulateDrive }

/** Which device carries the armature current, from the simulated mode, the gate and the current's sign. */
export type DriveDevice = 'Q1' | 'D1' | 'Q2' | 'D2' | 'none'

export interface DriveState {
  k: number
  t: number
  ia: number
  w: number
  n: number
  e: number
  va: number
  te: number
  tl: number
  gate: boolean
  duty: number
  zero: boolean
  device: DriveDevice
  /** Net accelerating torque / J. */
  accel: number
  /** Electrical power into the armature va·ia. */
  pa: number
  phase: 'supply' | 'freewheel' | 'zero current' | 'regenerating' | 'braking'
}

export function driveStateAt(r: DriveRun, k: number): DriveState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const t = r.time[i]
  const gate = s.gate[i] > 0.5
  const zero = r.modes[i] === 'z'
  const ia = s.ia[i]
  let device: DriveDevice = 'none'
  if (!zero) {
    if (p.bridge === '1q') device = gate ? 'Q1' : 'D2'
    else device = gate ? (ia >= 0 ? 'Q1' : 'D1') : ia >= 0 ? 'D2' : 'Q2'
  }
  const accel = (p.ke * ia - p.b * s.w[i] - s.tl[i]) / p.j
  const phase: DriveState['phase'] = zero ? 'zero current' : ia < 0 ? (gate ? 'regenerating' : 'braking') : gate ? 'supply' : 'freewheel'
  return { k: i, t, ia, w: s.w[i], n: s.n[i], e: s.e[i], va: s.va[i], te: s.te[i], tl: s.tl[i], gate, duty: s.duty[i], zero, device, accel, pa: s.va[i] * ia, phase }
}

const PHASE_TEXT: Record<DriveState['phase'], string> = {
  supply: 'supply → motor',
  freewheel: 'freewheeling',
  'zero current': 'zero current (DCM)',
  regenerating: 'regenerating → supply',
  braking: 'braking (Q2 on)',
}

export function driveView(st: DriveState, r: DriveRun): StateView {
  const p = r.params
  const path =
    st.device === 'Q1'
      ? `Vdc → Q1 → armature → back to Vdc (${formatA(st.ia)})`
      : st.device === 'D2'
        ? `armature → ${p.bridge === '1q' ? 'freewheeling diode D' : 'D2'} → armature (${formatA(st.ia)})`
        : st.device === 'D1'
          ? `armature → D1 → back into Vdc (${formatA(st.ia, true)}): energy returns`
          : st.device === 'Q2'
            ? `armature → Q2 → armature (${formatA(st.ia, true)}): the back-EMF drives the current`
            : 'no current: the diode blocks, the terminals float at the back-EMF'
  return {
    badge: { text: PHASE_TEXT[st.phase], tone: st.phase === 'supply' ? 'on' : st.phase === 'zero current' ? 'off' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'speed', v: `${st.n.toFixed(0)} rpm`, tone: 'ok' },
      { k: 'armature current', v: formatA(st.ia, true) },
      { k: 'terminal voltage', v: formatV(st.va) },
      { k: 'back-EMF k·ω', v: formatV(st.e) },
      { k: 'gate', v: st.gate ? 'ON' : 'OFF', tone: st.gate ? 'on-q' : 'off' },
      { k: 'conducting', v: st.device === 'none' ? 'nothing' : st.device, tone: st.device.startsWith('Q') ? 'on-q' : st.device === 'none' ? 'off' : 'on-d' },
      { k: 'motor torque', v: `${st.te.toFixed(3)} N·m`, min: 'standard' },
      { k: 'load torque', v: `${st.tl.toFixed(3)} N·m`, min: 'standard' },
      { k: 'duty', v: `${(st.duty * 100).toFixed(1)} %`, min: 'standard' },
      { k: 'acceleration', v: `${(st.accel * 60 / (2 * Math.PI)).toFixed(0)} rpm/s`, min: 'engineer' },
      { k: 'armature power', v: formatW(st.pa), min: 'engineer' },
    ],
    path,
  }
}

export function driveWhy(r: DriveRun, st: DriveState, m: DriveMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const dEnd = p.duties[p.periods - 1]
  // the load the motor carries at the end of the run (after a load step, the new one)
  const tlEnd = loadAt(p, p.duration)
  const now: Record<DriveState['phase'], Omit<WhyCard, 'id' | 'question'>> = {
    supply: {
      what: `Q1 is on: the armature sees Vdc = ${formatV(p.vdc, false)} while the back-EMF is ${formatV(st.e)}.`,
      why: `The difference drives the current up: La·dia/dt = Vdc − Ra·ia − k·ω = ${formatV(p.vdc - p.ra * st.ia - st.e)}.`,
      equation: 'La·dia/dt = Vdc − Ra·ia − E,  E = k·ω',
      physics: `The supply delivers ${formatW(p.vdc * st.ia)}; the torque k·ia = ${st.te.toFixed(3)} N·m ${st.accel > 0 ? 'accelerates' : 'is less than the load: the motor slows'}.`,
      whatIf: 'A higher duty keeps Q1 on longer each period: a higher mean voltage, a higher speed.',
    },
    freewheel: {
      what: `Q1 is off; the current ${formatA(st.ia)} keeps flowing through the ${p.bridge === '1q' ? 'freewheeling diode' : 'lower device'}: the terminal voltage is about 0 V.`,
      why: 'The armature inductance will not let the current stop at once. With 0 V applied, only the back-EMF and Ra act on it: it decays.',
      equation: 'La·dia/dt = −Ra·ia − E  (falling)',
      physics: 'No energy comes from the supply now: the inductance and the rotating mass keep the motor going.',
      whatIf: 'A larger La or a higher switching frequency makes the current fall less in each off-interval: less ripple.',
    },
    'zero current': {
      what: `The current has fallen to zero and the diode blocks: no current, the terminals float at the back-EMF ${formatV(st.e)}.`,
      why: 'The one-quadrant chopper cannot carry negative current. The inductor ran out of energy before Q1 turned on again: DISCONTINUOUS conduction.',
      equation: 'ia = 0,  va = E = k·ω',
      physics: `The mean terminal voltage is now d·Vdc plus E during the zero-current gaps — higher than d·Vdc, so the speed (SIMULATION ${m.nEnd.toFixed(0)} rpm) exceeds the averaged-model value.`,
      whatIf: 'More load torque (more current) or more inductance brings back continuous conduction.',
    },
    regenerating: {
      what: `The current is negative (${formatA(st.ia, true)}) while Q1's gate is on: it flows back through D1 into the supply.`,
      why: `The back-EMF ${formatV(st.e)} exceeds the mean applied voltage: the machine works as a generator and pushes current against Vdc.`,
      equation: 'P to the supply = −Vdc·ia > 0',
      physics: `Energy returned to the supply so far in this run: ${formatSI(m.eregen, 'J')} (SIMULATION).`,
      whatIf: 'A one-quadrant chopper has no path for this current: the motor could only coast.',
    },
    braking: {
      what: `The current is negative (${formatA(st.ia, true)}) and Q2 is on: the back-EMF drives the current through Q2 and the armature.`,
      why: 'Shorting the armature lets the back-EMF build up negative current in La; when Q2 turns off that current is forced back into the supply.',
      equation: 'La·dia/dt = −Ra·ia − E  (more negative)',
      physics: 'The torque k·ia is negative: the machine brakes.',
      whatIf: 'Raising the duty again reverses the current back to motoring.',
    },
  }
  cards.push({ id: 'now', question: `What is happening now? (${PHASE_TEXT[st.phase]})`, ...now[st.phase] })
  cards.push({
    id: 'speed',
    question: 'Why does the motor settle at this speed?',
    what: `SIMULATION: ${m.nEnd.toFixed(0)} rpm with ${formatA(m.iEnd)} mean current and ${formatV(m.vaEnd)} mean terminal voltage${m.settled ? '' : ' — not yet settled at the end of the run'}.`,
    why: 'The speed rises until the back-EMF k·ω is almost equal to the mean applied voltage: what is left, Ra·ī, drives just the current whose torque k·ī balances the load.',
    equation: 'k·ω = v̄a − Ra·ī,   k·ī = TL + B·ω',
    physics: `Averaged model: ω = (d·Vdc − Ra·TL/k)/(k + Ra·B/k) = ${rpm(((dEnd * p.vdc - (p.ra * tlEnd) / p.ke) / (p.ke + (p.ra * p.b) / p.ke))).toFixed(0)} rpm at d = ${(dEnd * 100).toFixed(0)} %${tlEnd !== p.tl ? `, TL = ${tlEnd.toFixed(2)} N·m (after the load step)` : ''}${m.dcm ? ' — but the current is discontinuous here, so the mean voltage is higher' : ''}.`,
    whatIf: 'More load torque needs more current, so a little more voltage is lost in Ra: the speed droops by Ra·ΔTL/k².',
  })
  if (p.view === 'startup')
    cards.push({
      id: 'inrush',
      question: 'Why is the starting current so large?',
      what: `SIMULATION: the current peaks at ${formatA(m.iPeak)}, ${(m.iPeak / Math.max(Math.abs(m.iEnd), 1e-9)).toFixed(0)}× the running current.`,
      why: `At rest there is no back-EMF: only Ra (${formatSI(p.ra, 'Ω')}) and La limit the current. As the speed builds up, k·ω opposes the supply and the current falls.`,
      equation: `locked rotor: ī = d·Vdc/Ra = ${formatA((p.duty * p.vdc) / p.ra)}`,
      physics: `The electrical time constant La/Ra = ${formatTime(p.tauE)} is shorter than the mechanical one J·Ra/k² = ${formatTime(p.tauM)}: the current rises before the rotor moves much.`,
      whatIf: p.tramp > 0 ? `The soft start (${formatTime(p.tramp)} duty ramp) already limits the peak.` : 'A soft start (ramping the duty) or a current limit keeps the peak down.',
    })
  cards.push({
    id: 'ripple',
    question: 'What sets the current ripple?',
    what: `SIMULATION: ${formatA(m.ripple)} peak-to-peak in the last period.`,
    why: 'During the on-time the current rises by roughly (Vdc − E)·d·Ts/La; in the off-time it falls by E·(1 − d)·Ts/La. In steady state the two are equal.',
    equation: `ΔI ≈ Vdc·d·(1 − d)/(La·fs) = ${formatA((p.vdc * dEnd * (1 - dEnd)) / (p.la * p.fs))}`,
    physics: 'The ripple causes torque ripple (k·ΔI) and extra copper loss — but the rotor inertia filters it: the speed barely ripples.',
    whatIf: 'Doubling fs or La halves the ripple; it is largest at d = 50 %.',
  })
  return cards
}

/** SIMULATION vs THEORY (exact PWL solution) and the averaged model. */
export function compareDrive(r: DriveRun, m: DriveMeasurements): CompareResult {
  const p = r.params
  const ex = exactDrive(p)
  const av = averagedDrive(p)
  const rows: CompareRow[] = []
  const unsettled = p.view === 'startup' && !m.settled ? 'the run has not settled: the averaged value is the final steady state' : null
  const dcmNa = m.dcm ? 'discontinuous conduction: the averaged model assumes the current never stops' : undefined
  const iScale = Math.max(Math.abs(ex.iEnd), ex.ripple, 1e-3)
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tb: number | null, formula: string, notes: string[], scale?: number, notApplicable?: string) => {
    if (sim === null || exact === null) return
    const den = scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const textbook: TextbookValue | null = tb === null && !notApplicable ? null : { key, value: notApplicable ? null : tb, formula, assumptions: notes, notApplicable }
    rows.push({ key, label, unit, sim, exact, error, tolerance: 0.005, pass: error <= 0.005, absolute: scale !== undefined, textbook, textbookError: textbook?.value != null ? (sim - textbook.value) / Math.max(Math.abs(textbook.value), 1e-30) : null })
  }
  const ssNotes = ['averaged model: the switch replaced by its mean voltage d·Vdc', ...(unsettled ? [unsettled] : [])]
  add('n', 'Speed (mean, last period)', 'rpm', rpm(m.wEnd), rpm(ex.wEnd), rpm(p.view === 'startup' ? av.wSteady : av.wSteady), 'ω = (d·Vdc − Ra·TL/k)/(k + Ra·B/k)', ssNotes, undefined, dcmNa)
  add('i', 'Armature current (mean)', 'A', m.iEnd, ex.iEnd, av.iSteady, 'ī = (TL + B·ω)/k', ssNotes, iScale, dcmNa)
  add('ripple', 'Current ripple (peak-to-peak)', 'A', m.ripple, ex.ripple, av.ripple, 'ΔI ≈ Vdc·d·(1 − d)/(La·fs)', ['small ripple: the current changes linearly, ω constant over a period'], iScale, dcmNa)
  add('imin', 'Minimum current', 'A', m.iMin, ex.iMin, av.iSteady - av.ripple / 2, 'ī − ΔI/2', ['continuous conduction'], iScale, dcmNa)
  if (p.view === 'startup') {
    add('peak', 'Peak start-up current', 'A', m.iPeak, ex.iPeak, av.iPeak, 'averaged model (no ripple)', ['the averaged model misses the ripple on top of the mean'])
    add('t90', 'Time to 90 % speed', 's', m.t90, ex.t90, av.t90, 'averaged model', ['the averaged model ignores the ripple and discontinuous conduction'])
    if (p.tstep !== null) add('nPre', 'Speed before the step', 'rpm', m.wPre === null ? null : rpm(m.wPre), ex.wPre === null ? null : rpm(ex.wPre), av.wPre === null ? null : rpm(av.wPre), 'averaged model', ['averaged model'])
    if (p.bridge === '2q' && ex.iNeg < -1e-6) add('neg', 'Most negative current (braking)', 'A', m.iNeg, ex.iNeg, av.iNeg, 'averaged model', ['averaged model'], Math.max(Math.abs(ex.iNeg), 1e-3))
  }
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `SIMULATION: trapezoidal time-stepping of the chopper and motor with every gate edge and current zero located exactly. THEORY: the exact piecewise-linear solution (matrix exponential) of the same equations${p.view === 'steady' ? ', its periodic steady state by Newton shooting' : ''}. Textbook: the averaged model.`,
    note: m.dcm ? 'The current is discontinuous: the averaged textbook formulas do not apply (shown as N/A).' : undefined,
  }
}

export function driveEventLabel(e: RunEvent): string {
  if (e.kind === 'gate-on') return 'Q1 turns on'
  if (e.kind === 'gate-off') return 'Q1 turns off'
  if (e.kind === 'il-zero') return 'Armature current reaches zero: discontinuous conduction'
  if (e.device === 'peak') return 'Peak start-up current'
  if (e.device === 'load-step') return 'Load torque step'
  if (e.device === 'duty-step') return 'Duty step'
  if (e.device === 'ramp-end') return 'Soft start complete'
  if (e.device === 'z→c') return 'Current starts again'
  return e.device ?? e.kind
}

export function driveEventWhy(e: RunEvent): string {
  const v = `ia = ${formatA(e.values.ia ?? 0, true)}, speed ${(e.values.n ?? 0).toFixed(0)} rpm.`
  if (e.device === 'peak') return `${v} The back-EMF has grown enough that the mean applied voltage minus k·ω no longer drives the current up: from here the current falls as the motor speeds up.`
  // the step's direction and the run's outcome are read from the event (recorded by the simulation)
  const from = e.values.from ?? 0
  const to = e.values.to ?? 0
  const nB = e.values.nBefore ?? 0
  const nE = e.values.nEnd ?? 0
  const speed = Math.abs(nE - nB) < 0.005 * Math.max(Math.abs(nB), 1) ? `the speed stays near ${nB.toFixed(0)} rpm` : `the speed ${nE > nB ? 'rises' : 'falls'} from ${nB.toFixed(0)} to ${nE.toFixed(0)} rpm by the end of the run`
  if (e.device === 'load-step') {
    if (to === from) return `${v} The load torque does not change (${from.toFixed(2)} N·m): ${speed}.`
    return to > from
      ? `${v} More load torque (${from.toFixed(2)} → ${to.toFixed(2)} N·m): the motor slows until the lower back-EMF lets enough extra current flow to carry it — ${speed}.`
      : `${v} Less load torque (${from.toFixed(2)} → ${to.toFixed(2)} N·m): the extra motor torque accelerates the rotor until the higher back-EMF cuts the current back — ${speed}.`
  }
  if (e.device === 'duty-step') {
    if (to === from) return `${v} The duty does not change (${(from * 100).toFixed(0)} %): ${speed}.`
    if (to > from) return `${v} The duty rises (${(from * 100).toFixed(0)} → ${(to * 100).toFixed(0)} %): the mean voltage d·Vdc rises above the back-EMF, the current grows and the motor accelerates — ${speed}.`
    const iE = e.values.iEnd ?? 0
    return `${v} The duty falls (${(from * 100).toFixed(0)} → ${(to * 100).toFixed(0)} %): the mean voltage d·Vdc drops below the back-EMF, so the current falls — it reverses if the chopper allows it (2Q, braking: energy flows back to the supply) or stops (1Q, the motor coasts) — ${speed}${iE < 0 ? '; the current is still negative at the end of the run (braking)' : ''}.`
  }
  if (e.kind === 'il-zero') return `${v} The inductor's energy is used up before the next on-time: the diode blocks and the terminal voltage jumps to the back-EMF.`
  return `${v} The circuit equations change form here.`
}

type L = Lesson<DriveParams, DriveRun, DriveMeasurements, DriveState>

export const DRIVE_LESSONS: L[] = [
  {
    id: 'start',
    title: 'Starting a DC motor',
    summary: 'Inrush current, back-EMF, and where the starting energy goes.',
    check: {
      question: 'Why is the starting current of a DC motor so large?',
      options: ['the inductance is largest at standstill', 'at standstill there is no back-EMF, so only Ra (and La) limit the current', 'the load torque is largest at standstill'],
      answer: 1,
      explain: 'The back-EMF k·ω is zero at rest, so the applied voltage only meets Ra (and briefly La). As the motor speeds up, k·ω opposes the supply and the current falls.',
    },
    base: { view: 'startup', bridge: '1q', event: 'none', tramp: 0 },
    steps: [
      {
        title: '1 · At rest: only Ra limits the current',
        at: (r) => 0.3 * (r.events.find((e) => e.device === 'peak')?.time ?? r.params.period),
        window: (r) => [0, 0.5 * (measureDrive(r).t90 ?? r.params.duration)],
        channels: ['ia', 'n', 'e', 'va'],
        look: 'The current shoots up while the speed has barely started.',
        body: (st, _m, r) => `The motor is still almost at rest (${st.n.toFixed(0)} rpm), so the back-EMF is only ${formatV(st.e)}. The chopper applies ${(r.params.duty * 100).toFixed(0)} % of ${formatV(r.params.vdc, false)} and only Ra = ${formatSI(r.params.ra, 'Ω')} resists: the current is already ${formatA(st.ia)}.`,
      },
      {
        title: '2 · The current peaks',
        at: (r) => r.events.find((e) => e.device === 'peak')?.time ?? 0,
        window: (r) => [0, 1.2 * (measureDrive(r).t90 ?? r.params.duration)],
        channels: ['ia', 'n', 'e'],
        look: 'The peak, then the current falls while the speed keeps rising.',
        body: (st, m) => `Peak ${formatA(m.iPeak)} (SIMULATION). The back-EMF is now ${formatV(st.e)}: it subtracts from the applied voltage, so from here the current falls as the motor gains speed.`,
      },
      {
        title: '3 · Running: back-EMF ≈ applied voltage',
        at: (r) => r.params.duration - 0.5 * r.params.period,
        window: (r) => [r.params.duration - 6 * r.params.period, r.params.duration],
        channels: ['ia', 'va', 'e', 'gate'],
        look: 'Zoomed in: the PWM chops Vdc; the current ripples around its mean; the back-EMF is almost flat.',
        body: (_st, m, r) => `${m.nEnd.toFixed(0)} rpm. The mean terminal voltage ${formatV(m.vaEnd)} is almost all back-EMF (${formatV(r.params.ke * m.wEnd)}); the rest, Ra·ī = ${formatV(r.params.ra * m.iEnd)}, drives the ${formatA(m.iEnd)} the load needs.`,
      },
      {
        title: '4 · Where did the starting energy go?',
        at: (r) => r.params.duration - 0.5 * r.params.period,
        channels: ['n', 'ia', 'pin'],
        look: 'The supply power is huge at the start and small once running.',
        body: (_st, m) => `The supply delivered ${formatSI(m.ein, 'J')}: ${formatSI(m.ekin, 'J')} is now stored in the spinning rotor, ${formatSI(m.ecu, 'J')} was turned into heat in Ra, ${formatSI(m.eload + m.efr, 'J')} went to the load and friction. Starting from rest costs about as much heat in Ra as the kinetic energy it stores.`,
      },
    ],
  },
  {
    id: 'brake',
    title: 'Slowing down: one quadrant or two',
    summary: 'Reduce the duty — and see why only a two-quadrant chopper can brake.',
    check: {
      question: 'You lower the duty of a ONE-quadrant chopper. The armature current…',
      options: ['reverses and brakes the motor', 'falls to zero and the motor coasts down', 'stays the same'],
      answer: 1,
      explain: 'A one-quadrant chopper can only drive current into the motor. When d·Vdc falls below the back-EMF the current drops to zero and the motor coasts. Braking (negative current, energy back to the supply) needs the second switch of a two-quadrant chopper.',
    },
    base: { view: 'startup', event: 'duty', d2: 0.3, tramp: 0 },
    steps: [
      {
        title: '1 · One quadrant: the current just stops',
        params: { bridge: '1q' },
        at: (r) => (r.params.tstep ?? 0) + 0.15 * (r.params.duration - (r.params.tstep ?? 0)),
        window: (r) => [0.6 * (r.params.tstep ?? 0), r.params.duration],
        channels: ['n', 'ia', 'va', 'duty'],
        look: 'After the duty step the current falls to zero and stays there; the speed falls slowly.',
        body: (st, m) => `The back-EMF ${formatV(st.e)} is now above the mean applied voltage, but the diode cannot carry negative current: ia = ${formatA(st.ia)}. The motor only coasts, slowed by the load — after the run it still turns at ${m.nEnd.toFixed(0)} rpm.`,
      },
      {
        title: '2 · Two quadrants: the current reverses',
        params: { bridge: '2q' },
        at: (r) => r.events.find((e) => e.device === 'duty-step')!.time + 3 * r.params.tauE,
        window: (r) => [0.6 * (r.params.tstep ?? 0), r.params.duration],
        channels: ['n', 'ia', 'pin', 'duty'],
        look: 'The current goes strongly negative; the supply power goes negative: energy flows back.',
        body: (st, m) => `ia = ${formatA(st.ia, true)}: negative torque brakes the rotor, and the current flows back into the supply. In this run ${formatSI(m.eregen, 'J')} was returned. The speed settles at ${m.nEnd.toFixed(0)} rpm far sooner than by coasting.`,
      },
    ],
  },
  {
    id: 'ripple',
    title: 'Current ripple and discontinuous conduction',
    summary: 'Zoom into the PWM periods — and see the current stop at light load.',
    check: {
      question: 'At light load the armature current stops during each off-time. Compared with the averaged model, the speed is…',
      options: ['higher', 'lower', 'the same'],
      answer: 0,
      explain: 'While the current is zero the terminals show the back-EMF instead of 0 V, so the mean armature voltage is higher than d·Vdc, and so is the speed.',
    },
    base: { view: 'steady', bridge: '1q' },
    steps: [
      {
        title: '1 · Continuous conduction',
        params: { tl: 0.1 },
        at: (r) => r.params.period * (1 + 0.5 * r.params.duty),
        window: (r) => [0, r.params.duration],
        channels: ['ia', 'va', 'e', 'gate'],
        look: 'The current rises while Q1 is on and falls while the diode freewheels — it never reaches zero.',
        body: (_st, m) => `Ripple ${formatA(m.ripple)} around ${formatA(m.iEnd)}: the current never reaches zero, so the terminal voltage is a clean pulse train between Vdc and 0 V.`,
      },
      {
        title: '2 · Light load: the current stops',
        params: { tl: 0.02 },
        at: (r) => {
          const z = r.events.find((e) => e.kind === 'il-zero')
          return z ? z.time + 0.5 * r.params.period * (1 - r.params.duty) * 0.5 : r.params.period
        },
        window: (r) => [0, r.params.duration],
        channels: ['ia', 'va', 'e', 'gate'],
        look: 'The current hits zero before the next on-time; the terminal voltage then shows the back-EMF.',
        body: (st, m) => `At light load the mean current (${formatA(m.iEnd)}) is smaller than half the ripple: the current reaches zero and the diode blocks. The terminal voltage is now the back-EMF ${formatV(st.e)}, so the speed (${m.nEnd.toFixed(0)} rpm) is higher than d·Vdc/k predicts.`,
      },
    ],
  },
]

export const DRIVE_EXPERIMENTS: Array<Experiment<DriveParams, DriveMeasurements>> = [
  {
    id: 'load',
    title: 'Double the load torque',
    change: (p) => ({ tl: Math.max(0.05, p.tl * 2) }),
    question: (p) => `The load torque goes from ${p.tl} to ${Math.max(0.05, p.tl * 2)} N·m. What happens?`,
    choices: ['The current about doubles; the speed drops only a little', 'The speed halves; the current stays the same', 'Nothing changes'],
    judge: (b, a) => (a.iEnd / b.iEnd > 1.5 && a.wEnd / b.wEnd > 0.85 ? 0 : a.wEnd / b.wEnd < 0.6 ? 1 : 2),
    rows: ['nEnd', 'iEnd', 'ripple'],
    why: (b, a, p0) => `Current ${formatA(b.iEnd)} → ${formatA(a.iEnd)}, speed ${b.nEnd.toFixed(0)} → ${a.nEnd.toFixed(0)} rpm. The torque k·ī must match the load, so the current follows the load torque; the speed only drops by the extra Ra·Δī that is no longer available as back-EMF (Ra·Δī/k = ${rpm((p0.ra * (a.iEnd - b.iEnd)) / p0.ke).toFixed(0)} rpm).`,
  },
  {
    id: 'duty',
    title: 'Halve the duty ratio',
    change: (p) => ({ duty: p.duty / 2 }),
    question: (p) => `The duty goes from ${(p.duty * 100).toFixed(0)} % to ${(p.duty * 50).toFixed(0)} %. What happens to the speed?`,
    choices: ['It roughly halves', 'It stays the same', 'It doubles'],
    judge: (b, a) => (a.wEnd / b.wEnd > 0.3 && a.wEnd / b.wEnd < 0.7 ? 0 : a.wEnd / b.wEnd >= 0.7 && a.wEnd / b.wEnd < 1.3 ? 1 : 2),
    rows: ['nEnd', 'iEnd', 'vaEnd'],
    why: (b, a) => `Speed ${b.nEnd.toFixed(0)} → ${a.nEnd.toFixed(0)} rpm, mean voltage ${formatV(b.vaEnd)} → ${formatV(a.vaEnd)}. The chopper sets the mean armature voltage d·Vdc and the speed follows the back-EMF; it falls a little more than half because Ra·ī stays the same${a.dcm ? ' — less, here: at this duty the current is discontinuous, which raises the mean voltage' : ''}.`,
  },
  {
    id: 'inductance',
    title: 'Four times the armature inductance',
    change: (p) => ({ la: p.la * 4 }),
    question: () => 'La is multiplied by four. What happens to the current ripple?',
    choices: ['It falls to about a quarter', 'It stays the same', 'It grows'],
    judge: (b, a) => (a.ripple / b.ripple < 0.4 ? 0 : a.ripple / b.ripple < 1.1 ? 1 : 2),
    rows: ['ripple', 'iEnd', 'nEnd'],
    why: (b, a) => `Ripple ${formatA(b.ripple)} → ${formatA(a.ripple)}, while the mean current (${formatA(b.iEnd)} → ${formatA(a.iEnd)}) and the speed hardly change: the inductance only limits how fast the current can change within a period.`,
  },
  {
    id: 'light',
    title: 'Light load',
    change: (p) => ({ tl: p.tl / 5 }),
    question: (p) => `The load torque drops to ${(p.tl / 5).toFixed(3)} N·m. What happens to the armature current waveform?`,
    choices: ['It becomes discontinuous: it reaches zero in each period', 'It stays continuous'],
    judge: (b, a) => (a.dcm && !b.dcm ? 0 : a.dcm ? 0 : 1),
    rows: ['iEnd', 'ripple', 'nEnd'],
    why: (b, a, p0) =>
      p0.bridge === '2q'
        ? `The two-quadrant chopper lets the current go negative, so it never stops: the ripple (${formatA(a.ripple)}) just swings below zero.`
        : `Mean current ${formatA(b.iEnd)} → ${formatA(a.iEnd)} with about the same ripple (${formatA(a.ripple)}): once the mean is below half the ripple the current reaches zero and the diode blocks. ${a.dcm ? `The speed then rises to ${a.nEnd.toFixed(0)} rpm — the mean voltage includes the back-EMF during the gaps.` : ''}`,
  },
]

export function drivePredictions(seed: number): Array<PredictTask<DriveParams, DriveMeasurements>> {
  const duty = [0.4, 0.5, 0.7][seed % 3]
  const tl = [0.1, 0.2, 0.3][(seed + 1) % 3]
  const fs = [5e3, 10e3, 20e3][(seed + 2) % 3]
  return [
    {
      id: 'speed',
      prompt: `Vdc = 48 V, duty ${(duty * 100).toFixed(0)} %, k = 0.1 V·s/rad, almost no load (TL = 0). Predict the steady speed.`,
      params: { duty, tl: 0, view: 'steady', bridge: '2q' },
      kind: 'number',
      unit: 'rpm',
      answer: (m) => m.nEnd,
      tolerance: 0.03,
      hint: 'At no load the back-EMF equals the mean applied voltage d·Vdc.',
      theory: (p) => `ω ≈ d·Vdc/k = ${((p.duty * p.vdc) / p.ke).toFixed(1)} rad/s = ${rpm((p.duty * p.vdc) / p.ke).toFixed(0)} rpm (slightly less: friction needs a little current)`,
    },
    {
      id: 'current',
      prompt: `Load torque TL = ${tl} N·m, k = 0.1 N·m/A. Predict the mean armature current.`,
      params: { tl, view: 'steady' },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.iEnd,
      tolerance: 0.05,
      hint: 'In steady state the motor torque k·ī balances the load (plus a little friction).',
      theory: (p) => `ī = (TL + B·ω)/k ≈ TL/k = ${formatA(p.tl / p.ke)}`,
    },
    {
      id: 'ripple',
      prompt: `Vdc = 48 V, d = 60 %, La = 2 mH, fs = ${fs / 1e3} kHz. Predict the peak-to-peak current ripple.`,
      params: { fs, view: 'steady', tl: 0.3 },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ripple,
      tolerance: 0.05,
      hint: 'ΔI ≈ Vdc·d·(1 − d)/(La·fs).',
      theory: (p) => `ΔI ≈ ${formatA((p.vdc * p.duty * (1 - p.duty)) / (p.la * p.fs))}`,
    },
  ]
}

export { DRIVE_DEFAULTS, gateAt }
