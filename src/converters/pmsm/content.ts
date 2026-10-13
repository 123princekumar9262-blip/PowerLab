import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import type { EnergyModel, NextConsequence, StatusInfo } from '../../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { loadAt, measurePmsm, PMSM_DEFAULTS, rpm, simulatePmsm, wRefAt, type PmsmMeasurements, type PmsmParams, type PmsmRun } from './model.ts'
import { exactPmsm, steadyPmsm, textbookPmsm } from './theory.ts'

export { measurePmsm, simulatePmsm }

export interface PmsmState {
  k: number
  t: number
  n: number
  w: number
  nref: number
  id: number
  iq: number
  idref: number
  iqref: number
  i: [number, number, number]
  v: [number, number, number]
  vd: number
  vq: number
  vmag: number
  vmax: number
  te: number
  tl: number
  theta: number
  /** Speed PI at the current limit (+1 / −1), voltage limited, field weakening active. */
  sat: number
  vlim: boolean
  fw: boolean
  pel: number
  pmech: number
  phase: 'accelerating' | 'braking' | 'regulating' | 'voltage-limited' | 'field-weakening'
}

export function pmsmStateAt(r: PmsmRun, k: number): PmsmState {
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const sat = r.sat[i]
  const vlim = r.vlim[i] === 1
  const fw = r.fwOn[i] === 1
  const phase: PmsmState['phase'] = vlim ? 'voltage-limited' : sat === 1 ? 'accelerating' : sat === -1 ? 'braking' : fw ? 'field-weakening' : 'regulating'
  return {
    k: i,
    t: r.time[i],
    n: s.n[i],
    w: s.w[i],
    nref: s.nref[i],
    id: s.id[i],
    iq: s.iq[i],
    idref: s.idref[i],
    iqref: s.iqref[i],
    i: [s.ia[i], s.ib[i], s.ic[i]],
    v: [s.va[i], s.vb[i], s.vc[i]],
    vd: s.vd[i],
    vq: s.vq[i],
    vmag: s.vmag[i],
    vmax: s.vmax[i],
    te: s.te[i],
    tl: s.tl[i],
    theta: s.theta[i],
    sat,
    vlim,
    fw,
    pel: s.pel[i],
    pmech: s.pmech[i],
    phase,
  }
}

const PHASE_TEXT: Record<PmsmState['phase'], string> = {
  accelerating: 'at the current limit',
  braking: 'braking at the current limit',
  regulating: 'speed regulated',
  'voltage-limited': 'voltage limit',
  'field-weakening': 'field weakening',
}

export function pmsmView(st: PmsmState, r: PmsmRun): StateView {
  const p = r.params
  return {
    badge: { text: PHASE_TEXT[st.phase], tone: st.phase === 'regulating' ? 'on' : st.phase === 'voltage-limited' ? 'off' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'speed / reference', v: `${st.n.toFixed(0)} / ${st.nref.toFixed(0)} rpm`, tone: 'ok' },
      { k: 'iq (torque current)', v: `${formatA(st.iq, true)} (ref ${formatA(st.iqref, true)})` },
      { k: 'id (flux current)', v: `${formatA(st.id, true)} (ref ${formatA(st.idref, true)})` },
      { k: 'torque', v: `${st.te.toFixed(3)} N·m` },
      { k: 'phase currents a, b, c', v: st.i.map((x) => formatA(x, true)).join(', '), min: 'standard' },
      { k: 'vd, vq', v: `${formatV(st.vd)}, ${formatV(st.vq)}`, min: 'standard' },
      { k: '|v| / limit Vdc/√3', v: `${formatV(st.vmag, false)} / ${formatV(st.vmax, false)}`, tone: st.vlim ? 'bad' : undefined, min: 'standard' },
      { k: 'rotor angle θe', v: `${st.theta.toFixed(1)}°`, min: 'standard' },
      { k: 'load torque', v: `${st.tl.toFixed(3)} N·m`, min: 'standard' },
      { k: 'speed PI', v: st.sat === 0 ? 'linear' : `at the current limit ±${formatA(p.imax)}`, min: 'engineer' },
      { k: 'electrical power 1.5·(vd·id + vq·iq)', v: formatW(st.pel), min: 'engineer' },
    ],
  }
}

export function pmsmStatus(st: PmsmState): StatusInfo {
  const facts = [`iq ${formatA(st.iq, true)}`, `id ${formatA(st.id, true)}`, `Te ${st.te.toFixed(3)} N·m`]
  if (st.vlim) facts.push('|v| at Vdc/√3')
  return { headline: `${st.n.toFixed(0)} rpm (ref ${st.nref.toFixed(0)}) · ${PHASE_TEXT[st.phase]}`, facts, tone: st.phase === 'regulating' ? 'on' : st.phase === 'voltage-limited' ? 'off' : 'idle' }
}

export function pmsmEventLabel(e: RunEvent): string {
  switch (e.device) {
    case 'unsat':
      return 'Speed PI leaves the current limit'
    case 'sat':
      return 'Speed PI reaches the current limit'
    case 'speed-step':
      return 'Speed reference step'
    case 'load-step':
      return 'Load torque step'
    case 'peak':
      return 'Speed overshoot peak'
    case 'dip':
      return 'Deepest speed dip after the load step'
    case 'vlim':
      return 'Voltage reaches the inverter limit Vdc/√3'
    case 'vfree':
      return 'Voltage back below the limit'
    case 'fw-on':
      return 'Field weakening starts (id* goes negative)'
    case 'fw-off':
      return 'Field weakening ends (id* back to 0)'
    default:
      return e.device ?? e.kind
  }
}

export function pmsmEventWhy(e: RunEvent): string {
  const v = `speed ${(e.values.n ?? 0).toFixed(0)} rpm, iq ${formatA(e.values.iq ?? 0, true)}.`
  switch (e.device) {
    case 'unsat':
      return `${v} The speed error is now small enough that the PI's demand Kpω·e + xω falls below the current limit: from here the loop is linear and the speed approaches the reference.`
    case 'sat':
      return `${v} The PI asks for more than the current limit allows: iq* is clamped, the motor accelerates at the largest torque and the integrator is frozen (anti-windup).`
    case 'speed-step':
      return `${v} The reference jumps ${(e.values.from ?? 0).toFixed(0)} → ${(e.values.to ?? 0).toFixed(0)} rpm: the proportional part asks for extra iq at once, the integral part builds up while the error lasts.`
    case 'load-step':
      return `${v} The load torque jumps ${(e.values.from ?? 0).toFixed(2)} → ${(e.values.to ?? 0).toFixed(2)} N·m: the rotor slows until the PI has raised iq enough to carry it — then the integral action brings the speed back to the reference.`
    case 'peak':
      return `${v} The overshoot comes from the PI's zero: the integrator is still charged when the error crosses zero.`
    case 'dip':
      return `${v} Here the motor torque has caught up with the new load: from now on the rotor accelerates back to the reference.`
    case 'vlim':
      return `${v} The back-EMF ωe·ψ plus the current loop's demand reach the most the inverter can make: the current loop loses authority.`
    case 'vfree':
      return `${v} The demanded voltage is again inside the inverter's range.`
    case 'fw-on':
      return `${v} The voltage demand has reached 95 % of Vdc/√3: the field-weakening integrator lowers id* so the stator flux opposes the magnet and the voltage stays within reach.`
    case 'fw-off':
      return `${v} The voltage has room again: id* returns to zero.`
    default:
      return ''
  }
}

export function pmsmNext(r: PmsmRun, st: PmsmState): NextConsequence | null {
  const t = st.t + 0.5 * r.params.dt
  const e = r.events.find((x) => x.time > t)
  if (!e) return null
  return { text: `${pmsmEventLabel(e)} at t = ${formatTime(e.time)}. ${pmsmEventWhy(e)}`, time: e.time }
}

export function pmsmWhy(r: PmsmRun, st: PmsmState, m: PmsmMeasurements): WhyCard[] {
  const p = r.params
  const tb = textbookPmsm(p)
  const we = p.pp * st.w
  const cards: WhyCard[] = []
  const now: Record<PmsmState['phase'], Omit<WhyCard, 'id' | 'question'>> = {
    accelerating: {
      what: `The speed error is large: the speed PI asks for more than ${formatA(p.imax)}, so iq* is clamped at the current limit and the motor accelerates at ${(p.kt * st.iqref).toFixed(3)} N·m.`,
      why: 'A drive must protect its inverter and windings: the speed loop may only ask for currents within the limit. The integrator is frozen meanwhile, so it does not wind up.',
      equation: 'iq* = Imax,  J·dω/dt = kt·iq − B·ω − TL',
      physics: `The current loop follows iq* with its own time constant 1/ωc = ${formatTime(1 / p.wc)}; the speed then rises almost linearly.`,
      whatIf: 'A larger current limit shortens the acceleration (more torque); the inverter has to carry it.',
    },
    braking: {
      what: `The speed is above the reference: iq* is clamped at −${formatA(p.imax)} — the machine brakes.`,
      why: 'Negative iq means negative torque: the rotor\'s energy flows back to the DC link.',
      equation: 'iq* = −Imax',
      physics: `Electrical power now ${formatW(st.pel)} (negative = returned).`,
      whatIf: 'Without a braking resistor or a regenerative supply, the DC-link voltage would rise.',
    },
    regulating: {
      what: `The speed PI sets iq* = ${formatA(st.iqref, true)}; the q-axis current loop delivers iq = ${formatA(st.iq, true)} and id is held at ${formatA(st.id, true)}.`,
      why: 'In the rotor (d–q) frame the three sinusoidal phase currents become two constants: iq makes torque against the magnet flux, id only changes the flux. With id = 0 every ampere goes into torque.',
      equation: 'Te = 1.5·p·(ψ·iq + (Ld − Lq)·id·iq) = kt·iq  (id = 0)',
      physics: `kt = 1.5·p·ψ = ${p.kt.toFixed(4)} N·m/A: ${formatA(st.iq, true)} gives ${st.te.toFixed(3)} N·m now.`,
      whatIf: 'If the controller did not know the rotor angle θe, it could not separate torque current from flux current — FOC needs a position sensor (or an observer).',
    },
    'voltage-limited': {
      what: `The voltage demand ${formatV(Math.hypot(st.vd, st.vq), false)} has hit the inverter's limit Vdc/√3 = ${formatV(st.vmax, false)}.`,
      why: `The back-EMF ωe·ψ = ${formatV(we * p.psi, false)} plus the drops in R and L need more than the DC link can give: the current loop loses control until the demand falls.`,
      equation: '|v| = √(vd² + vq²) ≤ Vdc/√3  (space-vector PWM, linear range)',
      physics: 'The current integrators are frozen while limited (anti-windup).',
      whatIf: 'Field weakening (id < 0) lowers the voltage needed at high speed.',
    },
    'field-weakening': {
      what: `id = ${formatA(st.id, true)}: the stator current weakens the magnet's flux, so the voltage stays at ${formatV(st.vmag, false)} (limit ${formatV(st.vmax, false)}).`,
      why: 'Above base speed ωe·ψ alone would exceed the voltage limit. A negative d-axis current makes a flux Ld·id against ψ: the back-EMF falls to ωe·(ψ + Ld·id).',
      equation: 'vq = R·iq + ωe·(Ld·id + ψ),   vd = R·id − ωe·Lq·iq',
      physics: `Flux now ψ + Ld·id = ${(p.psi + p.ld * st.id).toFixed(4)} Wb against ψ = ${p.psi} Wb. The current limit leaves less for iq: √(Imax² − id²) = ${formatA(Math.sqrt(Math.max(p.imax ** 2 - st.id ** 2, 0)))}.`,
      whatIf: 'The faster you go, the more id is needed and the less torque is available: constant-power operation.',
    },
  }
  cards.push({ id: 'now', question: `What is happening now? (${PHASE_TEXT[st.phase]})`, ...now[st.phase] })
  cards.push({
    id: 'frame',
    question: 'Why are the phase currents sinusoidal but id and iq constant?',
    what: `At ${st.n.toFixed(0)} rpm the phase currents alternate at fe = ${formatSI((p.pp * Math.abs(st.w)) / (2 * Math.PI), 'Hz')}; id and iq stay flat in steady state.`,
    why: 'The Park transform measures the current vector from the rotor (d along the magnet, q 90° ahead). The vector turns with the rotor, so seen from the rotor it stands still.',
    equation: 'ia = id·cos θe − iq·sin θe  (ib, ic shifted by ∓120°)',
    physics: `Phase-current amplitude √(id² + iq²) = ${formatA(Math.hypot(st.id, st.iq))}.`,
    whatIf: 'A PI controller only removes errors in constant quantities: that is why FOC controls id and iq, not ia, ib, ic.',
  })
  cards.push({
    id: 'loops',
    question: 'How fast do the current and speed loops respond?',
    what: `SIMULATION: iq rises 10–90 % in ${m.iqRise === null ? '—' : formatTime(m.iqRise)}; after the speed step the speed overshoots by ${m.overshoot === null ? '—' : `${(m.overshoot * 100).toFixed(1)} %`}.`,
    why: `The current PI's zero cancels the winding pole (Ki/Kp = R/L): the current loop becomes first order with bandwidth ωc = ${(p.wc / (2 * Math.PI)).toFixed(0)} Hz × 2π. The speed PI is tuned for ωs = ${p.fsc} Hz × 2π, ζ = ${p.zeta}.`,
    equation: `rise = ln 9/ωc = ${formatTime(tb.iqRise)};  overshoot (ideal current loop) = ${tb.overshoot === null ? '—' : `${(tb.overshoot * 100).toFixed(1)} %`}`,
    physics: 'The PI\'s zero causes the overshoot even at ζ = 1 (13.5 %); the current loop adds a little more delay.',
    whatIf: 'Keep the speed loop at least 10× slower than the current loop, or the two interact.',
  })
  cards.push({
    id: 'voltage',
    question: 'Why does the voltage grow with speed?',
    what: `Now |v| = ${formatV(st.vmag, false)} of the ${formatV(st.vmax, false)} the inverter can make (SIMULATION).`,
    why: 'The magnet induces ωe·ψ in the q-axis; the controller must apply at least that plus R·iq. At base speed it reaches Vdc/√3.',
    equation: 'vq = R·iq + ωe·(Ld·id + ψ),  vd = R·id − ωe·Lq·iq',
    physics: `Base speed (no load) ≈ Vdc/(√3·p·ψ) = ${rpm(p.vmax / (p.pp * p.psi)).toFixed(0)} rpm.`,
    whatIf: p.control === 'fw' ? 'Field weakening is on: above base speed id goes negative.' : 'With field weakening (id < 0) the motor can run above base speed.',
  })
  return cards
}

/**
 * When the exact linear-loop theory does not describe the run, and why — for the part of the run from `from`
 * to `to` (a voltage-limit episode at start-up does not affect a later step response that starts from steady state).
 */
export function pmsmApplicability(r: PmsmRun, m: PmsmMeasurements, from = 0, to = Infinity): string | null {
  const p = r.params
  if (p.decouple === 'off') return 'decoupling is off: the PI controllers must also fight the back-EMF and the cross-coupling, which the exact (decoupled, linear) theory leaves out'
  if (m.fwFrac > 0) return 'field weakening is active: a nonlinear voltage loop the exact theory leaves out'
  const k0 = Math.max(0, Math.floor(from / p.dt))
  const k1 = Math.min(r.length - 1, Math.ceil(Math.min(to, p.duration) / p.dt))
  let hit = r.events.some((e) => (e.device === 'vlim' || e.device === 'vfree') && e.time >= from && e.time <= to)
  for (let k = k0; k <= k1 && !hit; k++) if (r.vlim[k]) hit = true
  if (hit) return 'the voltage limit was reached: the exact theory assumes the inverter can always deliver the commanded voltage'
  return null
}

/** SIMULATION vs THEORY: the exact linear-loop response, the steady d–q state, the textbook formulas. */
export function comparePmsm(r: PmsmRun, m: PmsmMeasurements): CompareResult {
  const p = r.params
  const ex = exactPmsm(r)
  const tb = textbookPmsm(p)
  const wEnd = wRefAt(p, p.duration)
  const ss = steadyPmsm(p, wEnd, loadAt(p, p.duration))
  const na = pmsmApplicability(r, m)
  const firstStep = Math.min(p.t1 ?? Infinity, p.t2 ?? Infinity)
  const naStart = pmsmApplicability(r, m, 0, firstStep)
  const naStep = p.t1 !== null ? pmsmApplicability(r, m, p.t1, p.t2 !== null && p.t2 > p.t1 ? p.t2 : Infinity) : na
  const naLoad = p.t2 !== null ? pmsmApplicability(r, m, p.t2) : na
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tbv: number | null, formula: string, notes: string[], tolerance: number, opts: { scale?: number; expected?: string | null } = {}) => {
    if (sim === null || exact === null || !Number.isFinite(sim) || !Number.isFinite(exact)) return
    const den = opts.scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const textbook: TextbookValue | null = tbv === null ? null : { key, value: tbv, formula, assumptions: notes }
    rows.push({ key, label, unit, sim, exact, error, tolerance, pass: error <= tolerance, absolute: opts.scale !== undefined, textbook, textbookError: tbv !== null ? (sim - tbv) / Math.max(Math.abs(tbv), 1e-30) : null, expected: opts.expected ?? undefined })
  }
  // dynamics: the exact solution of the same (linear, decoupled) loop; both measured on the same samples
  const DYN = 1e-3
  const lin = 'ideal current loop (iq = iq*), second-order speed loop with the PI zero'
  add('tDesat', 'Start-up: speed PI leaves the current limit', 's', m.tDesat, ex.tDesat, 1 / p.wc + (p.j * (p.w1 - p.imax / Math.max(p.kpw, 1e-12))) / (p.kt * p.imax - p.tl), 't ≈ 1/ωc + J·(ω1 − Imax/Kpω)/(kt·Imax − TL)', ['constant torque kt·Imax until Kpω·e falls below Imax; the current lags by 1/ωc'], DYN, { expected: naStart })
  add('t90', 'Start-up: time to 90 % of the reference', 's', m.t90, ex.t90, null, '', [], DYN, { expected: naStart })
  add('iqRise', 'Current loop: iq rise time 10–90 %', 's', m.iqRise, ex.iqRise, tb.iqRise, 't = ln 9/ωc', ['the PI zero cancels R/L: closed loop ωc/(s + ωc)'], DYN, { expected: naStart })
  add('overshoot', 'Speed step: overshoot', '%', m.overshoot, ex.overshoot, tb.overshoot, p.zeta === 1 ? '1 + e^(−2): 13.5 % at t = 2/ωs (ζ = 1)' : 'ideal-current-loop step response', [lin], DYN, { expected: naStep })
  add('tPeak', 'Speed step: time of the peak', 's', m.tPeak, ex.tPeak, tb.tPeak, p.zeta === 1 ? 't = 2/ωs' : 'ideal-current-loop step response', [lin], DYN, { expected: naStep })
  if (m.dip !== null && ex.dip !== null) add('dipRpm', 'Load step: speed dip', 'rpm', rpm(m.dip), rpm(ex.dip), tb.dip === null ? null : rpm(tb.dip), p.zeta === 1 ? 'Δω = ΔTL/(e·J·ωs) at t = 1/ωs' : 'ideal-current-loop response', [lin], DYN, { expected: naLoad })
  add('tDip', 'Load step: time of the deepest dip', 's', m.tDip, ex.tDip, tb.tDip, p.zeta === 1 ? 't = 1/ωs' : 'ideal-current-loop response', [lin], DYN, { expected: naLoad })
  // steady state at the end of the run (closed form, the same for the textbook)
  const ST = 5e-3
  const unsettled = m.settled ? null : 'the run has not settled at its end'
  const infeasible = ss.feasible ? null : 'the reference cannot be reached within the voltage and current limits'
  const steadyNote = unsettled ?? infeasible
  const dq = 'steady state: d/dt = 0 in the d–q equations'
  add('nEnd', 'Speed at the end (reference)', 'rpm', m.nEnd, rpm(ss.w), rpm(ss.w), 'ω = ω* (integral action)', [dq], ST, { expected: steadyNote })
  add('iqEnd', 'iq at the end', 'A', m.iqEnd, ss.iq, (p.tl + p.b * wEnd) / p.kt, 'iq = (TL + B·ω)/kt,  kt = 1.5·p·ψ', [dq, 'id = 0'], ST, { expected: steadyNote })
  add('idEnd', 'id at the end', 'A', m.idEnd, ss.id, ss.fw ? null : 0, ss.fw ? '|v(id)| = 0.95·Vdc/√3' : 'id = 0', [dq], ST, { scale: p.imax, expected: steadyNote })
  add('vqEnd', 'vq at the end', 'V', m.vqEnd, ss.vq, p.r * ss.iq + p.pp * wEnd * p.psi, 'vq = R·iq + ωe·(Ld·id + ψ)', [dq], ST, { scale: Math.max(Math.abs(ss.vq), 0.01 * p.vmax), expected: steadyNote })
  add('vdEnd', 'vd at the end', 'V', m.vdEnd, ss.vd, -p.pp * wEnd * p.lq * ss.iq, 'vd = R·id − ωe·Lq·iq', [dq], ST, { scale: Math.max(Math.abs(ss.vq), 0.01 * p.vmax), expected: steadyNote })
  add('teEnd', 'Torque at the end', 'N·m', m.teEnd, ss.te, ss.te, 'Te = TL + B·ω', [dq], ST, { scale: Math.max(Math.abs(ss.te), 1e-3 * p.kt * p.imax), expected: steadyNote })
  return {
    rows,
    allPass: rows.every((x) => x.pass || !!x.expected),
    header:
      'SIMULATION: RK4 of the full d–q machine with the controllers and the averaged inverter (voltage limit Vdc/√3; switching ripple not modelled), regime changes located. THEORY: the decoupled linear loop solved exactly (matrix exponentials, current-limit exits located), measured on the same samples; the steady d–q equations at the end.',
    note: na ? `Some dynamic rows are not checked: ${na}.` : undefined,
  }
}

export function pmsmEnergy(st: PmsmState, m: PmsmMeasurements, r: PmsmRun): EnergyModel {
  const p = r.params
  const pcu = 1.5 * p.r * (st.id ** 2 + st.iq ** 2)
  const pem = st.te * st.w
  const pmag = st.pel - pcu - pem
  const pfr = p.b * st.w * st.w
  const pload = st.tl * st.w
  const pkin = pem - pfr - pload
  const ledger = [
    { id: 'inv', label: 'Inverter (DC link)', watts: -st.pel, note: '1.5·(vd·id + vq·iq), lossless averaged inverter (− = supplying)' },
    { id: 'cu', label: 'Winding resistance', watts: pcu, note: '1.5·R·(id² + iq²)' },
    { id: 'l', label: 'Winding inductance', watts: pmag, note: 'stores 0.75·(Ld·id² + Lq·iq²)' },
    { id: 'rotor', label: 'Rotor (kinetic energy)', watts: pkin, note: 'Te·ω − B·ω² − TL·ω' },
    { id: 'fr', label: 'Friction', watts: pfr, note: 'B·ω²' },
    { id: 'load', label: 'Load', watts: pload, note: 'TL·ω' },
  ]
  let wMax = 0
  for (const w of r.signals.w) wMax = Math.max(wMax, Math.abs(w))
  const ekin = 0.5 * p.j * st.w * st.w
  const emag = 0.75 * (p.ld * st.id ** 2 + p.lq * st.iq ** 2)
  return {
    ledger,
    stores: [
      { id: 'rotor', label: 'Rotor ½·J·ω²', joules: ekin, fraction: ekin / Math.max(0.5 * p.j * wMax * wMax, 1e-15), detail: `${pkin >= 0 ? 'gaining' : 'losing'} ${formatW(Math.abs(pkin))}` },
      { id: 'l', label: 'Windings 0.75·(Ld·id² + Lq·iq²)', joules: emag, fraction: Math.min(1, emag / Math.max(0.75 * Math.max(p.ld, p.lq) * p.imax ** 2, 1e-15)), detail: `${pmag >= 0 ? 'storing' : 'releasing'} ${formatW(Math.abs(pmag))}` },
    ],
    balance: ledger.reduce((a, x) => a + x.watts, 0),
    tolerance: 1e-6 * Math.max(1e-9, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9,
    summary: `Over the last electrical period: ${formatW(m.pel)} in, ${formatW(m.pcu)} copper loss, ${formatW(m.pshaft)} to the load${m.eff !== null ? ` — efficiency ${(m.eff * 100).toFixed(1)} %` : ''} (SIMULATION).`,
  }
}

export function pmsmReadings(m: PmsmMeasurements, r: PmsmRun): Reading[] {
  const p = r.params
  return [
    { id: 'n', label: 'Speed at the end', value: m.nEnd.toFixed(0), unit: 'rpm', note: `reference ${rpm(wRefAt(p, p.duration)).toFixed(0)} rpm` },
    { id: 'iq', label: 'Torque current iq', value: m.iqEnd.toFixed(2), unit: 'A', note: 'Te = 1.5·p·ψ·iq' },
    ...(m.overshoot !== null ? [{ id: 'os', label: 'Speed-step overshoot', value: (m.overshoot * 100).toFixed(1), unit: '%', note: 'PI zero: 13.5 % at ζ = 1' }] : []),
    { id: 'v', label: 'Voltage |v| / limit', value: `${m.vEnd.toFixed(1)} / ${p.vmax.toFixed(1)}`, unit: 'V', note: 'vq ≈ ωe·ψ + R·iq', min: 'standard' as const },
  ]
}

// ── Lessons, experiments, predictions ─────────────────────────────────────────

type L = Lesson<PmsmParams, PmsmRun, PmsmMeasurements, PmsmState>
const lastPeriods = (r: PmsmRun, k = 2): [number, number] => [Math.max(0, r.params.duration - k * r.params.period), r.params.duration]
const evT = (r: PmsmRun, device: string) => r.events.find((e) => e.device === device)?.time

export const PMSM_LESSONS: L[] = [
  {
    id: 'foc',
    title: 'Field-oriented control: the rotor frame',
    summary: 'Three sinusoidal currents become two constants: iq for torque, id for flux.',
    check: {
      question: 'With id = 0 control, the motor torque is set by…',
      options: ['id', 'iq', 'the phase angle of the voltage'],
      answer: 1,
      explain: 'Te = 1.5·p·ψ·iq when id = 0: iq is the torque-producing current (90° ahead of the magnet), id only changes the flux.',
    },
    base: { event: 'none', control: 'id0', decouple: 'on' },
    steps: [
      {
        title: '1 · Three sinusoidal phase currents',
        at: (r) => r.params.duration - 0.25 * r.params.period,
        window: (r) => lastPeriods(r),
        channels: ['ia', 'ib', 'ic'],
        look: 'Balanced sine waves, 120° apart, at the electrical frequency p·n/60.',
        body: (st, m, r) => `At ${m.nEnd.toFixed(0)} rpm and ${r.params.pp} pole pairs the currents alternate at ${formatSI(m.fe, 'Hz')}; their amplitude is ${formatA(m.iAmp)} (SIMULATION). Now ia = ${formatA(st.i[0], true)}.`,
      },
      {
        title: '2 · Seen from the rotor: two constants',
        at: (r) => r.params.duration - 0.25 * r.params.period,
        window: (r) => lastPeriods(r),
        channels: ['id', 'iq', 'iqref'],
        look: 'id and iq are flat lines: the current vector turns with the rotor.',
        body: (st) => `The Park transform measures the current from the rotor's d-axis (the magnet) and q-axis (90° ahead): id = ${formatA(st.id, true)}, iq = ${formatA(st.iq, true)} — constants, which a PI controller can hold exactly.`,
      },
      {
        title: '3 · Torque from iq',
        at: (r) => r.params.duration - 0.25 * r.params.period,
        window: (r) => lastPeriods(r),
        channels: ['te', 'tl', 'iq'],
        look: 'A smooth torque — no commutation ripple, unlike the BLDC drive.',
        body: (st, _m, r) => `Te = 1.5·p·ψ·iq = 1.5 × ${r.params.pp} × ${r.params.psi} × ${st.iq.toFixed(3)} = ${(r.params.kt * st.iq).toFixed(4)} N·m (SIMULATION: ${st.te.toFixed(4)} N·m), carrying the ${st.tl} N·m load plus friction.`,
      },
      {
        title: '4 · The voltage: back-EMF on the q-axis',
        at: (r) => r.params.duration - 0.25 * r.params.period,
        window: (r) => lastPeriods(r),
        channels: ['vq', 'vd', 'vmag', 'vmax'],
        look: 'vq is almost the back-EMF ωe·ψ; vd is the small −ωe·Lq·iq; |v| stays below the limit.',
        body: (st, _m, r) => `vq = ${formatV(st.vq)} ≈ R·iq + ωe·ψ = ${formatV(r.params.r * st.iq + r.params.pp * st.w * r.params.psi)}; vd = ${formatV(st.vd)} = −ωe·Lq·iq. The inverter could give up to Vdc/√3 = ${formatV(st.vmax, false)}.`,
      },
    ],
  },
  {
    id: 'loops',
    title: 'Current loop and speed loop',
    summary: 'A fast first-order current loop inside a slower PI speed loop: start-up, speed step, load step.',
    check: {
      question: 'After the load step, the steady speed with the PI speed controller is…',
      options: ['lower than the reference, in proportion to the load', 'back exactly at the reference', 'higher than the reference'],
      answer: 1,
      explain: 'The integral term keeps raising iq* as long as there is a speed error: in steady state the error is zero, whatever the load (within the current limit).',
    },
    base: { event: 'both', control: 'id0', decouple: 'on' },
    steps: [
      {
        title: '1 · The current loop: a first-order rise',
        at: (r) => 2 / r.params.wc,
        window: (r) => [0, 8 / r.params.wc],
        channels: ['iq', 'iqref'],
        look: 'iq* jumps to the current limit; iq follows as 1 − e^(−ωc·t), with no overshoot.',
        body: (_st, m, r) => `10–90 % rise in ${m.iqRise === null ? '—' : formatTime(m.iqRise)} (SIMULATION) against ln 9/ωc = ${formatTime(Math.log(9) / r.params.wc)}: the PI's zero cancels the winding pole R/L, so the loop is first order with bandwidth ${r.params.fcc} Hz.`,
      },
      {
        title: '2 · Accelerating at the current limit',
        at: (r) => evT(r, 'unsat') ?? 0.5 * (r.params.t1 ?? r.params.duration),
        window: (r) => [0, r.params.t1 ?? r.params.duration],
        channels: ['n', 'nref', 'iq', 'iqref'],
        look: 'The speed ramps up at constant torque, then bends into the reference once the PI leaves the limit.',
        body: (_st, m, r) => `Full torque kt·Imax = ${(r.params.kt * r.params.imax).toFixed(3)} N·m until t = ${m.tDesat === null ? '—' : formatTime(m.tDesat)}, when the speed error is small enough (Kpω·e < Imax). 90 % of the reference at ${m.t90 === null ? '—' : formatTime(m.t90)} (SIMULATION).`,
      },
      {
        title: '3 · A speed step: overshoot',
        at: (r) => evT(r, 'peak') ?? r.params.t1 ?? 0,
        window: (r) => [(r.params.t1 ?? 0) - 0.1 * (6 / r.params.ws), (r.params.t1 ?? 0) + 6 / r.params.ws],
        channels: ['n', 'nref', 'iq'],
        look: 'The speed overshoots and settles; iq first jumps (proportional part), then decays.',
        body: (_st, m, r) => `Overshoot ${m.overshoot === null ? '—' : `${(m.overshoot * 100).toFixed(1)} %`} at ${m.tPeak === null ? '—' : formatTime(m.tPeak)} after the step (SIMULATION). With an ideal current loop and ζ = ${r.params.zeta} the PI's zero alone gives ${r.params.zeta === 1 ? '13.5 % at 2/ωs' : 'the textbook value in Analyze'}.`,
      },
      {
        title: '4 · A load step: dip and recovery',
        at: (r) => evT(r, 'dip') ?? r.params.t2 ?? 0,
        window: (r) => [(r.params.t2 ?? 0) - 0.1 * (8 / r.params.ws), Math.min(r.params.duration, (r.params.t2 ?? 0) + 8 / r.params.ws)],
        channels: ['n', 'nref', 'te', 'tl'],
        look: 'The speed dips, the torque rises to the new load, and the speed returns exactly to the reference.',
        body: (_st, m) => `Dip ${m.dip === null ? '—' : `${rpm(m.dip).toFixed(1)} rpm`} at ${m.tDip === null ? '—' : formatTime(m.tDip)} after the step; at the end ${m.nEnd.toFixed(1)} rpm with iq = ${formatA(m.iqEnd)} (SIMULATION): no steady error.`,
      },
    ],
  },
  {
    id: 'fw',
    title: 'Field weakening above base speed',
    summary: 'When the back-EMF reaches the voltage limit, a negative id weakens the flux.',
    check: {
      question: 'To run above base speed, field weakening makes id…',
      options: ['negative, opposing the magnet flux', 'positive, adding to the magnet flux', 'zero'],
      answer: 0,
      explain: 'A negative d-axis current makes the flux Ld·id against the magnet\'s ψ: the back-EMF ωe·(ψ + Ld·id) stays within the inverter\'s voltage at a higher speed — at the cost of current that makes no torque (SPM).',
    },
    base: { event: 'speed', control: 'fw', decouple: 'on', nref: 1500, n2: 5500 },
    steps: [
      {
        title: '1 · Below base speed: id = 0',
        at: (r) => (r.params.t1 ?? r.params.duration) - 0.5 * r.params.period,
        window: (r) => [0, r.params.duration],
        channels: ['n', 'nref', 'vmag', 'vmax'],
        look: 'At 1500 rpm the voltage needs only part of the inverter\'s range.',
        body: (st) => `|v| = ${formatV(st.vmag, false)} of ${formatV(st.vmax, false)}: id = ${formatA(st.id, true)}. The reference now jumps far above base speed.`,
      },
      {
        title: '2 · The voltage reaches its limit',
        at: (r) => evT(r, 'fw-on') ?? r.params.duration / 2,
        window: (r) => [0, r.params.duration],
        channels: ['n', 'vmag', 'vmax', 'id'],
        look: 'As the speed rises the back-EMF eats up the voltage margin.',
        body: (st, _m, r) => `At ${st.n.toFixed(0)} rpm ωe·ψ = ${formatV(r.params.pp * st.w * r.params.psi, false)}: the demand reaches 95 % of the limit and the field-weakening loop starts lowering id*.`,
      },
      {
        title: '3 · Negative id weakens the flux',
        at: (r) => r.params.duration - 0.5 * r.params.period,
        window: (r) => [0, r.params.duration],
        channels: ['id', 'iq', 'vmag', 'n'],
        look: 'id settles well below zero; the speed reaches the reference; |v| sits just under the limit.',
        body: (st, m, r) => `${m.nEnd.toFixed(0)} rpm with id = ${formatA(st.id, true)}: the flux is ψ + Ld·id = ${(r.params.psi + r.params.ld * st.id).toFixed(4)} Wb instead of ${r.params.psi} Wb. The phase current is ${formatA(m.iAmp)} for the same load torque — the price of speed.`,
      },
    ],
  },
]

export const PMSM_EXPERIMENTS: Array<Experiment<PmsmParams, PmsmMeasurements>> = [
  {
    id: 'load',
    title: 'Double the load torque',
    change: (p) => ({ tl: 2 * p.tl, tl2: 2 * p.tl2 }),
    question: (p) => `Both load torques double (${p.tl} → ${2 * p.tl} N·m before, ${p.tl2} → ${2 * p.tl2} N·m after the step). What happens at the end of the run?`,
    choices: ['iq about doubles; the speed is still exactly at the reference', 'the speed settles lower; iq stays the same', 'nothing changes'],
    judge: (b, a) => (a.iqEnd / b.iqEnd > 1.6 && Math.abs(a.nEnd - b.nEnd) < 0.01 * Math.max(b.nEnd, 1) ? 0 : a.nEnd < 0.99 * b.nEnd ? 1 : 2),
    rows: ['iqEnd', 'nEnd', 'dipRpm'],
    why: (b, a) => `iq ${formatA(b.iqEnd)} → ${formatA(a.iqEnd)}, speed ${b.nEnd.toFixed(1)} → ${a.nEnd.toFixed(1)} rpm (SIMULATION). Te = kt·iq must carry the load, so iq doubles (friction adds a little); the integral action removes the speed error. The dip at the load step grows: ${b.dip === null ? '—' : rpm(b.dip).toFixed(0)} → ${a.dip === null ? '—' : rpm(a.dip).toFixed(0)} rpm.`,
  },
  {
    id: 'decouple',
    title: 'Switch off the decoupling',
    change: () => ({ decouple: 'off' }),
    question: () => 'The feed-forward terms −ωe·Lq·iq and +ωe·(Ld·id + ψ) are removed. What happens?',
    choices: ['id no longer stays at zero during transients, and the responses slow down', 'nothing changes', 'the motor cannot reach the reference'],
    judge: (b, a) => (a.idPeak > 0.02 && a.idPeak > 100 * b.idPeak && Math.abs(a.nEnd - b.nEnd) < 0.01 * b.nEnd ? 0 : Math.abs(a.nEnd - b.nEnd) >= 0.01 * b.nEnd ? 2 : 1),
    rows: ['idPeak', 't90', 'overshoot', 'nEnd'],
    why: (b, a) => `Largest |id| ${formatA(b.idPeak)} → ${formatA(a.idPeak)}, time to 90 % speed ${b.t90 === null ? '—' : formatTime(b.t90)} → ${a.t90 === null ? '—' : formatTime(a.t90)} (SIMULATION). Without the feed-forward each PI integrator must build up the back-EMF and the cross-coupling voltage itself: while it does, the currents stray — but the integrators still win in steady state (${a.nEnd.toFixed(0)} rpm).`,
  },
  {
    id: 'bandwidth',
    title: 'Halve the current-loop bandwidth',
    change: (p) => ({ fcc: p.fcc / 2 }),
    question: (p) => `The current-loop bandwidth goes from ${p.fcc} Hz to ${p.fcc / 2} Hz. What happens to the iq rise time?`,
    choices: ['It doubles', 'It halves', 'It stays the same'],
    judge: (b, a) => {
      const k = (a.iqRise ?? 0) / Math.max(b.iqRise ?? 1, 1e-12)
      return k > 1.7 && k < 2.3 ? 0 : k < 0.7 ? 1 : 2
    },
    rows: ['iqRise', 'overshoot', 'dipRpm'],
    why: (b, a) => `Rise ${b.iqRise === null ? '—' : formatTime(b.iqRise)} → ${a.iqRise === null ? '—' : formatTime(a.iqRise)} (SIMULATION): the closed current loop is ωc/(s + ωc), its rise time ln 9/ωc. The speed loop barely notices (overshoot ${b.overshoot === null ? '—' : (b.overshoot * 100).toFixed(1)} → ${a.overshoot === null ? '—' : (a.overshoot * 100).toFixed(1)} %) because it is still much slower.`,
  },
  {
    id: 'speedbw',
    title: 'Double the speed-loop bandwidth',
    change: (p) => ({ fsc: 2 * p.fsc }),
    question: (p) => `The speed-loop bandwidth goes from ${p.fsc} Hz to ${2 * p.fsc} Hz. What happens to the speed dip at the load step?`,
    choices: ['It shrinks to about half', 'It stays the same', 'It grows'],
    judge: (b, a) => {
      const k = (a.dip ?? 0) / Math.max(b.dip ?? 1, 1e-12)
      return k < 0.65 && k > 0.35 ? 0 : k < 1.1 ? 1 : 2
    },
    rows: ['dipRpm', 'tDip', 'overshoot'],
    why: (b, a) => `Dip ${b.dip === null ? '—' : rpm(b.dip).toFixed(1)} → ${a.dip === null ? '—' : rpm(a.dip).toFixed(1)} rpm, reached after ${b.tDip === null ? '—' : formatTime(b.tDip)} → ${a.tDip === null ? '—' : formatTime(a.tDip)} (SIMULATION). The dip is ΔTL/(e·J·ωs): a faster loop reacts sooner. The gains grow with ωs and ωs² — more current per rpm of error.`,
  },
]

export function pmsmPredictions(seed: number): Array<PredictTask<PmsmParams, PmsmMeasurements>> {
  const tl = [0.3, 0.45, 0.6][seed % 3]
  const fcc = [250, 500, 1000][(seed + 1) % 3]
  const n = [1200, 1800, 2400][(seed + 2) % 3]
  return [
    {
      id: 'iq',
      prompt: `p = 4 pole pairs, ψ = 0.015 Wb, load ${tl} N·m (friction negligible). With id = 0, predict iq in steady state.`,
      params: { tl2: tl, event: 'both' },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.iqEnd,
      tolerance: 0.03,
      hint: 'Te = 1.5·p·ψ·iq must carry the load.',
      theory: (p) => `iq = TL/(1.5·p·ψ) = ${p.tl2}/(1.5 × ${p.pp} × ${p.psi}) = ${formatA(p.tl2 / (1.5 * p.pp * p.psi))}`,
    },
    {
      id: 'rise',
      prompt: `Current-loop bandwidth ${fcc} Hz (PI zero on the winding pole). Predict the 10–90 % rise time of iq, in milliseconds.`,
      params: { fcc },
      kind: 'number',
      unit: 'ms',
      answer: (m) => (m.iqRise ?? NaN) * 1e3,
      tolerance: 0.03,
      hint: 'The closed current loop is first order: ωc/(s + ωc), ωc = 2π·f.',
      theory: (p) => `t = ln 9/ωc = 2.197/(2π × ${p.fcc}) = ${((Math.log(9) / (2 * Math.PI * p.fcc)) * 1e3).toFixed(3)} ms`,
    },
    {
      id: 'overshoot',
      prompt: 'Speed loop tuned with ζ = 1, much slower than the current loop. Predict the overshoot after a small speed step, in %.',
      params: { zeta: 1, event: 'both' },
      kind: 'number',
      unit: '%',
      answer: (m) => (m.overshoot ?? NaN) * 100,
      tolerance: 0.1,
      hint: 'Closed loop (2ζωs·s + ωs²)/(s² + 2ζωs·s + ωs²): the PI zero causes an overshoot even at ζ = 1.',
      theory: () => 'y(t) = 1 + e^(−ωs·t)·(ωs·t − 1): peak 1 + e^(−2) ⇒ 13.5 % at t = 2/ωs (the current loop adds a little)',
    },
    {
      id: 'vq',
      prompt: `Steady ${n} rpm, p = 4, ψ = 0.015 Wb, R = 0.15 Ω, load 0.2 N·m. Predict vq.`,
      params: { nref: n, event: 'none', tl: 0.2 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vqEnd,
      tolerance: 0.03,
      hint: 'vq = R·iq + ωe·ψ (id = 0), ωe = p·2π·n/60.',
      theory: (p) => {
        const we = p.pp * ((p.nref * 2 * Math.PI) / 60)
        const iq = p.tl / (1.5 * p.pp * p.psi)
        return `vq = R·iq + ωe·ψ = ${p.r} × ${iq.toFixed(2)} + ${we.toFixed(1)} × ${p.psi} = ${formatV(p.r * iq + we * p.psi, false)}`
      },
    },
  ]
}

export { PMSM_DEFAULTS }
