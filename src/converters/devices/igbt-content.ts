import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, StatusInfo, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { exactIgbt, IGBT_DEFAULTS, igbtDerived, igbtVg, measureIgbt, textbookIgbt, type IgbtMeasurements, type IgbtParams, type IgbtRun } from './igbt.ts'

/** The phase of the IGBT test at an instant (from the simulated mode and the gate drive). */
export type IgbtPhase = 'off' | 'turn-on delay' | 'current rise' | 'voltage fall (Miller plateau)' | 'on-state' | 'turn-off delay' | 'voltage rise (Miller plateau)' | 'channel current fall' | 'tail current'

export interface IgbtState {
  k: number
  t: number
  vge: number
  vce: number
  vg: number
  ig: number
  ich: number
  ip: number
  ic: number
  idiode: number
  p: number
  energy: number
  region: 'cut' | 'sat' | 'ohm'
  diode: boolean
  phase: IgbtPhase
  vdsMos: number
  idMos: number
}

export function igbtStateAt(r: IgbtRun, k: number): IgbtState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const t = r.time[i]
  const mode = r.modes[i]
  const s = r.signals
  const d = igbtDerived(p, s.vge[i], s.vce[i], s.ip[i], t, mode)
  const diode = mode.endsWith('|D')
  const gateHigh = igbtVg(p, t - 1e-15) === p.vdrv
  let phase: IgbtPhase
  if (gateHigh) phase = d.region === 'cut' ? 'turn-on delay' : diode ? 'current rise' : d.region === 'sat' ? 'voltage fall (Miller plateau)' : 'on-state'
  else if (d.region === 'ohm') phase = 'turn-off delay'
  else if (!diode) phase = 'voltage rise (Miller plateau)'
  else if (d.region === 'sat') phase = 'channel current fall'
  else phase = t > p.toff && s.ip[i] > 0.005 * p.i0 ? 'tail current' : 'off'
  return { k: i, t, vge: s.vge[i], vce: s.vce[i], vg: d.vg, ig: d.ig, ich: d.ich, ip: s.ip[i], ic: d.ic, idiode: d.idiode, p: d.p, energy: s.energy[i], region: d.region, diode, phase, vdsMos: s.vdsMos[i], idMos: s.idMos[i] }
}

const regionText = (st: IgbtState) => (st.region === 'cut' ? 'channel OFF (vGE ≤ Vth)' : st.region === 'sat' ? 'active: the channel limits iC' : 'on-state: vCE = V0 + r·iC')

export function igbtView(st: IgbtState): StateView {
  return {
    badge: { text: st.phase, tone: st.phase === 'on-state' ? 'on' : st.phase === 'off' ? 'off' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'gate drive', v: formatV(st.vg) },
      { k: 'vGE', v: formatV(st.vge) },
      { k: 'vCE', v: formatV(st.vce) },
      { k: 'iC (collector)', v: formatA(st.ic) },
      { k: 'channel', v: regionText(st), full: true, tone: st.region === 'cut' ? 'off' : 'on-q' },
      { k: 'holes (tail part)', v: formatA(st.ip), tone: st.ip > 1e-3 ? 'on-q' : 'off' },
      { k: 'diode', v: st.diode ? `ON · ${formatA(st.idiode)}` : 'OFF', tone: st.diode ? 'on-d' : 'off' },
      { k: 'gate current', v: formatA(st.ig, true), min: 'standard' },
      { k: 'power in the IGBT', v: formatSI(st.p, 'W'), min: 'standard' },
      { k: 'energy so far', v: formatSI(st.energy, 'J'), min: 'standard' },
      { k: 'channel (electron) current', v: formatA(st.ich), min: 'engineer' },
    ],
    path: st.diode ? `I0 → freewheeling diode (${formatA(st.idiode)})${st.ic > 1e-3 ? ` and IGBT (${formatA(st.ic)})` : ''}` : `I0 → IGBT (${formatA(st.ic)})`,
  }
}

export function igbtStatus(st: IgbtState): StatusInfo {
  const facts = [`iC ${formatA(st.ic)}`, `vCE ${formatV(st.vce, false)}`]
  if (st.phase === 'tail current') facts.unshift('channel OFF, stored holes still flowing')
  else if (st.ip > 1e-3 && st.region !== 'cut') facts.push(`holes carry ${formatA(st.ip)}`)
  if (st.diode) facts.push(`diode ${formatA(st.idiode)}`)
  return { headline: st.phase.charAt(0).toUpperCase() + st.phase.slice(1), facts, tone: st.phase === 'on-state' ? 'on' : st.phase === 'off' ? 'off' : 'idle' }
}

export function igbtWhy(r: IgbtRun, st: IgbtState, m: IgbtMeasurements): WhyCard[] {
  const p = r.params
  const tau = p.rg * p.ciss
  const phaseCard: Record<IgbtPhase, Omit<WhyCard, 'id' | 'question'>> = {
    off: {
      what: `vGE = ${formatV(st.vge)} is below Vth = ${formatV(p.vth, false)}: the IGBT is off and the load current ${formatA(p.i0)} circulates through the freewheeling diode.`,
      why: 'No channel means no electron current, and without electrons the p+ collector injects no holes: the IGBT blocks the full voltage.',
      equation: 'iC = 0;  vCE = Vdc',
      physics: 'Zero current × full voltage: no power in the device.',
      whatIf: 'A negative gate-off voltage keeps vGE further from Vth: better immunity to noise.',
    },
    'turn-on delay': {
      what: `The driver switched to ${formatV(p.vdrv, false)}, but vGE = ${formatV(st.vge)} is still below Vth.`,
      why: `The driver must first charge the input capacitance Cge + Cgc = ${formatSI(p.ciss, 'F')} through Rg: an RC charge with τ = ${formatTime(tau)} — exactly as in a MOSFET (the IGBT's gate IS a MOSFET gate).`,
      equation: 'td(on) = Rg·Ciss·ln((Vdrv − Voff)/(Vdrv − Vth))',
      physics: `Gate current now ${formatA(st.ig)}: all of it charges the gate.`,
      whatIf: 'A smaller Rg shortens the delay.',
    },
    'current rise': {
      what: `The channel conducts ${formatA(st.ich)} of electrons; the collector carries ${formatA(st.ic)} while vCE stays at ${formatV(st.vce)}.`,
      why: `The diode still carries the rest (${formatA(st.idiode)}) and clamps vCE at Vdc. The holes have not built up yet (${formatA(st.ip)}): they follow the electron current with the carrier lifetime τ = ${formatTime(p.tau)}.`,
      equation: 'iC = gm·(vGE − Vth) + i_p;  vCE = Vdc while the diode conducts',
      physics: `Full voltage and rising current: ${formatSI(st.p, 'W')} right now — the first part of Eon.`,
      whatIf: 'A larger gm or a smaller load current shortens this phase.',
    },
    'voltage fall (Miller plateau)': {
      what: `The diode released; vCE falls (now ${formatV(st.vce)}) while vGE stays near ${formatV(st.vge)} — the Miller plateau.`,
      why: 'The channel must carry the load current, which fixes vGE; the gate current now discharges the gate–collector capacitance Cgc as vCE falls.',
      equation: 'dvCE/dt ≈ −(Vdrv − Vpl)/(Rg·Cgc)',
      physics: `Power now ${formatSI(st.p, 'W')}: the largest part of Eon = ${formatSI(m.eon, 'J')}.`,
      whatIf: 'A larger Cgc (Miller capacitance) makes the voltage fall slower.',
    },
    'on-state': {
      what: `The IGBT is fully on: vCE = ${formatV(st.vce)} at ${formatA(st.ic)}; of that, ${formatA(st.ip)} is carried by holes.`,
      why: `Unlike a MOSFET the on-state voltage does not start at zero: the current must first cross the p+ collector junction (a diode drop V0 = ${formatV(p.v0, false)}); above it the hole-flooded drift region behaves like a small resistance r = ${formatSI(p.rce, 'Ω')}.`,
      equation: `VCE(sat) = V0 + r·iC = ${formatV(p.v0 + p.rce * p.i0, false)};  P = VCE(sat)·I0`,
      physics: `Conduction loss ${formatSI(m.pcond, 'W')}; the MOSFET compared (Ron = ${formatSI(p.ronMos, 'Ω')}) would need ${formatV(m.mos.vdsOn, false)} → ${formatSI(m.mos.pcond, 'W')} (SIMULATION).`,
      whatIf: 'More current makes the IGBT look better: its voltage grows only with r, a MOSFET\'s with the whole Ron.',
    },
    'turn-off delay': {
      what: `The driver dropped to ${formatV(p.voff)} but the IGBT still conducts fully (vCE = ${formatV(st.vce)}).`,
      why: 'vGE must first fall from the drive level to the plateau before the channel starts to limit the current.',
      equation: 'td(off) = Rg·Ciss·ln((Vdrv − Voff)/(Vpl − Voff))',
      physics: `The turn-off plateau is lower than at turn-on (Vth + (1 − α)·I0/gm = ${formatV(p.vplOff, false)}): the holes carry α·I0, so the channel needs to carry only the rest.`,
      whatIf: 'A more negative off-voltage discharges the gate faster.',
    },
    'voltage rise (Miller plateau)': {
      what: `vCE rises (now ${formatV(st.vce)}) at full current while vGE sits on the plateau (${formatV(st.vge)}).`,
      why: 'The load current must keep flowing and the diode cannot take it before vCE reaches Vdc; the gate current charges Cgc the other way.',
      equation: 'dvCE/dt ≈ (Vpl − Voff)/(Rg·Cgc)',
      physics: `Full current and rising voltage: power now ${formatSI(st.p, 'W')}.`,
      whatIf: 'A larger Rg slows this phase: more loss, less dv/dt.',
    },
    'channel current fall': {
      what: `vCE reached Vdc; the diode takes the current back and the channel current falls fast (${formatA(st.ich)} left) — but the collector current only falls to the hole current ${formatA(st.ip)}.`,
      why: 'The gate controls only the electrons. The holes stored in the drift region are not removed by the gate: when the channel closes they are still there.',
      equation: 'iC = gm·(vGE − Vth) + i_p  →  i_p when vGE ≤ Vth',
      physics: `This fast part ends at the "knee" of the current waveform: from there on the tail.`,
      whatIf: 'A faster gate makes this part shorter — but it cannot shorten the tail.',
    },
    'tail current': {
      what: `The channel is OFF, yet the IGBT still conducts ${formatA(st.ic)} at vCE = ${formatV(st.vce)}.`,
      why: `The stored holes can only disappear by recombination, at the rate set by the carrier lifetime: the current decays as e^(−t/τ), τ = ${formatTime(p.tau)}. Nothing the gate does can speed it up.`,
      equation: 'i_tail(t) = I_tail0·e^(−(t − t_off)/τ);  E_tail = Vdc·∫i_tail dt ≈ Vdc·I_tail0·τ',
      physics: `Full voltage × the tail current: ${formatSI(st.p, 'W')} now. The tail costs ${formatSI(m.etail, 'J')} — ${(m.tailShare * 100).toFixed(0)} % of Eoff (SIMULATION).`,
      whatIf: 'A shorter lifetime (a "fast" IGBT, lifetime-killed by irradiation) shortens the tail — but fewer stored holes also mean a higher VCE(sat): the IGBT trade-off.',
    },
  }
  const cards: WhyCard[] = [{ id: 'phase', question: `What is happening now? (${st.phase})`, ...phaseCard[st.phase] }]
  cards.push({
    id: 'tail',
    question: 'Why does an IGBT have a tail current?',
    what: `SIMULATION: when the channel turned off the hole current was ${formatA(m.itail0 ?? NaN)} (α·I0 = ${formatA(p.alpha * p.i0)}); it then fell to 1/e in ${formatTime(m.tauTail ?? NaN)}.`,
    why: 'An IGBT is a MOSFET driving a PNP transistor. In the on-state the p+ collector floods the drift region with holes — that is what makes its on-state voltage low at high voltage ratings. At turn-off the gate removes only the electron current; the stored holes must recombine.',
    equation: 'di_p/dt = (k·i_ch − i_p)/τ,  k = α/(1 − α)  ⇒  i_p = α·iC in the on-state;  i_p = I_tail0·e^(−t/τ) after the channel closes',
    physics: `The tail flows at the full blocking voltage: E_tail = ${formatSI(m.etail, 'J')} of Eoff = ${formatSI(m.eoff, 'J')}.`,
    whatIf: `With α = 0 there would be no tail — and no conductivity modulation either: that is a MOSFET.`,
  })
  cards.push({
    id: 'compare',
    question: 'IGBT or MOSFET at these conditions?',
    what: `SIMULATION, same gate and test: Eoff ${formatSI(m.eoff, 'J')} (IGBT) vs ${formatSI(m.mos.eoff, 'J')} (MOSFET); on-state ${formatV(m.vceSat, false)} vs ${formatV(m.mos.vdsOn, false)}.`,
    why: 'The IGBT pays for its low on-state voltage with the tail; the MOSFET switches cleanly but its on-state voltage grows with Ron·I.',
    equation: `IGBT conducts better above I = V0/(Ron − r) = ${Number.isFinite(textbookIgbt(p).iCross) ? formatA(textbookIgbt(p).iCross) : '—'}`,
    physics: 'Few switchings per second, high current and voltage (traction, large drives): the IGBT wins. Fast switching at moderate current: the MOSFET (or SiC).',
    whatIf: 'Halve the load current: the IGBT\'s knee voltage V0 starts to dominate its on-state voltage.',
  })
  return cards
}

/** SIMULATION vs THEORY (exact PWL solution + the closed-form tail) and the textbook formulas. */
export function compareIgbt(r: IgbtRun, m: IgbtMeasurements): CompareResult {
  const p = r.params
  const ex = exactIgbt(p)
  const tb = textbookIgbt(p)
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tbv: number | null, formula: string, note: string, tol = 0.005) => {
    if (sim === null || exact === null || !Number.isFinite(sim) || !Number.isFinite(exact)) return
    const scale = Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / scale
    const textbook: TextbookValue | null = tbv === null ? null : { key, value: tbv, formula, assumptions: [note] }
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, textbook, textbookError: tbv !== null && tbv !== 0 ? (sim - tbv) / Math.abs(tbv) : null })
  }
  const tail = p.alpha > 0
  add('tdOn', 'Turn-on delay td(on)', 's', m.tdOn, ex.tdOn, tb.tdOn, 'Rg·Ciss·ln((Vdrv − Voff)/(Vdrv − Vth))', 'exact for the RC charge of the gate (no channel yet)')
  add('tri', 'Current rise t_ri', 's', m.tri, ex.tri, tb.tri, 'Rg·Ciss·ln((Vdrv − Vth)/(Vdrv − Vpl))', 'approximation: ends when gm·(vGE − Vth) = I0 (the Miller and hole currents are ignored)')
  add('tfv', 'Voltage fall t_fv', 's', m.tfv, ex.tfv, tb.tfv, 'Rg·Cgc·(Vdc − VCE(sat))/(Vdrv − Vpl)', 'approximation: a flat plateau at Vth + I0/gm')
  add('tdOff', 'Turn-off delay td(off)', 's', m.tdOff, ex.tdOff, tb.tdOff, 'Rg·Ciss·ln((Vdrv − Voff)/(Vpl,off − Voff))', 'approximation: ends at the plateau Vth + (1 − α)·I0/gm')
  add('trv', 'Voltage rise t_rv', 's', m.trv, ex.trv, tb.trv, 'Rg·Cgc·(Vdc − VCE(sat))/(Vpl,off − Voff)', 'approximation: a flat plateau; Cce ignored')
  add('tfi', 'Channel current fall t_fi', 's', m.tfi, ex.tfi, tb.tfi, 'Rg·Ciss·ln((Vpl,off − Voff)/(Vth − Voff))', 'approximation: starts from the textbook plateau')
  add('vceSat', 'On-state voltage VCE(sat)', 'V', m.vceSat, ex.vceSat, tb.vceSat, 'V0 + r·I0', 'exact in the on-state (the knee + drift resistance model)')
  add('eon', 'Turn-on energy Eon', 'J', m.eon, ex.eon, 0.5 * p.vdc * p.i0 * ((tb.tri ?? 0) + (tb.tfv ?? 0)), '½·Vdc·I0·(t_ri + t_fv)', 'approximation: straight current and voltage ramps')
  add('eoffMos', 'Turn-off energy, channel part', 'J', m.eoffMos, ex.eoffMos, 0.5 * p.vdc * p.i0 * (tb.trv + tb.tfi), '½·Vdc·I0·(t_rv + t_fi)', 'approximation: straight ramps (the tail is counted separately)')
  if (tail) {
    add('itail0', 'Tail current at channel turn-off', 'A', m.itail0, ex.itail0, tb.itail0, 'α·I0', 'approximation: the on-state hole share; the holes also decay a little during the voltage rise and the channel current fall')
    add('tauTail', 'Tail 1/e time', 's', m.tauTail, ex.tauTail, p.tau, 'τ (carrier lifetime)', 'exact: with the channel off, di_p/dt = −i_p/τ')
    add('qtail', 'Tail charge Q_tail', 'C', m.qtail, ex.qtail, tb.qtail, 'α·I0·τ', 'approximation: the full exponential at α·I0 (THEORY: I_tail0·τ·(1 − e^(−T/τ)) + Cgc·ΔvGE)')
    add('etail', 'Tail energy E_tail', 'J', m.etail, ex.etail, tb.etail, 'Vdc·α·I0·τ', 'approximation: E_tail = Vdc·Q_tail with the textbook charge')
  }
  add('eoff', 'Turn-off energy Eoff (with tail)', 'J', m.eoff, ex.eoff, 0.5 * p.vdc * p.i0 * (tb.trv + tb.tfi) + tb.etail, '½·Vdc·I0·(t_rv + t_fi) + Vdc·α·I0·τ', 'approximation: straight ramps plus the full textbook tail')
  add('plateauOff', 'Turn-off plateau', 'V', m.plateauOff, ex.plateauOff, p.vplOff, 'Vth + (1 − α)·I0/gm', 'approximation: the holes carry α·I0; the channel also carries the Cgc current')
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header:
      'SIMULATION: trapezoidal time-stepping of the double-pulse circuit (state vGE, vCE, i_p) with every region change located exactly. THEORY: the exact piecewise-linear solution (matrix exponential) of the same circuit; the tail in closed form (after the channel closes, i_p decays exactly as e^(−t/τ)). Textbook: the classical formulas.',
    note: `The MOSFET compared (same gate, Ron = ${formatSI(p.ronMos, 'Ω')}, no tail) is simulated alongside on the same time steps: Eon ${formatSI(m.mos.eon, 'J')}, Eoff ${formatSI(m.mos.eoff, 'J')}, on-state ${formatV(m.mos.vdsOn, false)}.`,
  }
}

export function igbtEventLabel(e: RunEvent): string {
  if (e.kind === 'gate-on') return 'Gate driver switches high'
  if (e.kind === 'gate-off') return 'Gate driver switches low'
  const [from, to] = (e.device ?? '').split('→')
  if (from?.startsWith('cut') && to?.startsWith('sat')) return 'vGE reaches Vth: the channel starts to conduct'
  if (from?.endsWith('|D') && to?.endsWith('|off')) return 'Diode releases: the IGBT carries the full load current'
  if (from?.startsWith('sat') && to?.startsWith('ohm')) return 'vCE collapses to the on-state voltage V0 + r·iC'
  if (from?.startsWith('ohm') && to?.startsWith('sat')) return 'The channel starts to limit the current (plateau reached)'
  if (from?.endsWith('|off') && to?.endsWith('|D')) return 'vCE reaches Vdc: the diode takes the current back'
  if (from?.startsWith('sat') && to?.startsWith('cut')) return 'Channel off — the tail current begins'
  return e.device ?? e.kind
}
export function igbtEventWhy(e: RunEvent): string {
  const tail = (e.device ?? '').endsWith('cut|D') && (e.values.ip ?? 0) > 1e-6
  return `At this instant vGE = ${formatV(e.values.vge ?? 0)}, vCE = ${formatV(e.values.vce ?? 0)}, iC = ${formatA(e.values.ic ?? 0)}${tail ? `, of which ${formatA(e.values.ip ?? 0)} are stored holes that the gate cannot remove` : ''}. The circuit equations change form here.`
}

/** A formatted SI value split into number and unit (the readings strip shows them apart). */
export function siParts(v: number, unit: string): { value: string; unit: string } {
  const s = formatSI(v, unit)
  const i = s.indexOf(' ')
  return { value: s.slice(0, i), unit: s.slice(i + 1) }
}

/** Readings strip: Eoff with its tail share, the on-state voltage, the MOSFET compared. */
export function igbtReadings(m: IgbtMeasurements, r: IgbtRun): Reading[] {
  const p = r.params
  return [
    { id: 'eoff', label: 'Turn-off energy, tail included', ...siParts(m.eoff, 'J'), note: `Eoff = channel part ${formatSI(m.eoffMos, 'J')} + tail ${formatSI(m.etail, 'J')}` },
    { id: 'tail', label: 'Share of Eoff lost in the tail', value: (m.tailShare * 100).toFixed(0), unit: '%', note: `E_tail ≈ Vdc·I_tail·τ, I_tail = ${formatA(m.itail0 ?? 0)}` },
    { id: 'vce', label: 'On-state voltage at I0', value: m.vceSat.toFixed(2), unit: 'V', note: `VCE(sat) = V0 + r·I0 = ${formatV(p.v0, false)} + ${formatSI(p.rce, 'Ω')}·${formatA(p.i0)}`, min: 'standard' },
    { id: 'mos', label: 'MOSFET, same test: Eoff / on-state', value: `${formatSI(m.mos.eoff, 'J')} / ${formatV(m.mos.vdsOn, false)}`, unit: '', note: `Ron = ${formatSI(p.ronMos, 'Ω')}, no tail (SIMULATION)`, min: 'standard' },
  ]
}

const T = (r: IgbtRun) => measureIgbt(r)
const offWin = (r: IgbtRun): [number, number] => {
  const m = T(r)
  const span = Math.max(1e-12, (m.tdOff ?? 0) + (m.trv ?? 0) + (m.tfi ?? 0))
  return [r.params.toff - 0.8 * span, r.params.toff + 4 * span]
}
const tailWin = (r: IgbtRun): [number, number] => [r.params.toff - 0.08 * (r.params.tend - r.params.toff), r.params.tend]
const t6 = (r: IgbtRun) => {
  const m = T(r)
  return r.params.toff + (m.tdOff ?? 0) + (m.trv ?? 0) + (m.tfi ?? 0)
}

export const IGBT_LESSONS: Array<Lesson<IgbtParams, IgbtRun, IgbtMeasurements, IgbtState>> = [
  {
    id: 'tail',
    title: 'The turn-off tail',
    summary: 'Why an IGBT keeps conducting after its channel is off — and what that costs.',
    check: {
      question: 'Right after the gate has turned the channel off, the IGBT’s collector current…',
      options: ['drops to zero at once, like a MOSFET', 'keeps flowing and decays with the carrier lifetime τ', 'reverses until the stored charge is removed'],
      answer: 1,
      explain: 'The gate controls only the electron current. The holes stored in the drift region must recombine, so the collector current falls only to the hole current and then decays as e^(−t/τ) — at the full blocking voltage.',
    },
    base: {},
    steps: [
      {
        title: '1 · On-state: electrons and holes',
        at: (r) => r.params.toff - 0.3 * (r.params.toff - r.params.ton),
        window: (r) => [r.params.ton - 0.05 * (r.params.toff - r.params.ton), r.params.toff],
        channels: ['ic', 'ich', 'ip', 'vce'],
        look: 'The collector current is split: part electrons (channel), part holes. The hole part builds up with the lifetime after turn-on.',
        body: (st, m) => `The collector carries ${formatA(st.ic)}: ${formatA(st.ich)} of electrons through the MOS channel and ${formatA(st.ip)} of holes injected by the p+ collector. vCE = ${formatV(st.vce)} = V0 + r·iC (SIMULATION ${formatV(m.vceSat, false)}).`,
      },
      {
        title: '2 · Turn-off: the voltage rises first',
        at: (r) => r.params.toff + (T(r).tdOff ?? 0) + 0.5 * (T(r).trv ?? 0),
        window: offWin,
        channels: ['vge', 'vce', 'ic', 'ip'],
        look: 'vGE sits on the Miller plateau while vCE climbs to Vdc at full current.',
        body: (st, m) => `As in a MOSFET, vCE must reach Vdc before the diode can take the current: vCE is ${formatV(st.vce)} now, and the rise takes ${formatTime(m.trv ?? NaN)}. vGE waits on the plateau (${formatV(m.plateauOff ?? NaN)}).`,
      },
      {
        title: '3 · The channel closes — the current does not',
        at: (r) => t6(r) + 0.02 * r.params.tau,
        window: offWin,
        channels: ['ic', 'ich', 'ip', 'vce'],
        look: 'iC drops fast, then stops at a "knee": the remaining current is the hole current.',
        body: (st, m) => `The channel current is ${formatA(st.ich)} — the gate has turned it off in ${formatTime(m.tfi ?? NaN)}. But iC is still ${formatA(st.ic)}: the stored holes (I_tail = ${formatA(m.itail0 ?? NaN)} when the channel closed, close to α·I0).`,
      },
      {
        title: '4 · The tail decays with the lifetime',
        at: (r) => t6(r) + r.params.tau,
        window: tailWin,
        channels: ['vce', 'ic', 'ip', 'pdev'],
        look: 'An exponential decay at the full voltage: power keeps flowing into the IGBT.',
        body: (st, m, r) => `One lifetime later (τ = ${formatTime(r.params.tau)}) the tail is down to ${formatA(st.ic)} ≈ I_tail/e, while vCE = ${formatV(st.vce)}. The SIMULATION measures a 1/e time of ${formatTime(m.tauTail ?? NaN)}.`,
      },
      {
        title: '5 · What the tail costs',
        at: (r) => r.params.tend - 0.05 * (r.params.tend - r.params.toff),
        window: tailWin,
        channels: ['vce', 'ic', 'energy'],
        look: 'The energy keeps climbing long after the fast part of the turn-off.',
        body: (_st, m) => `Eoff = ${formatSI(m.eoff, 'J')}: the fast part (voltage rise + channel current fall) ${formatSI(m.eoffMos, 'J')}, the tail ${formatSI(m.etail, 'J')} — ${(m.tailShare * 100).toFixed(0)} % of it. E_tail ≈ Vdc·I_tail·τ.`,
      },
    ],
  },
  {
    id: 'vs-mosfet',
    title: 'IGBT vs MOSFET, same test',
    summary: 'The same gate, the same voltage and current: who conducts better, who switches better?',
    check: {
      question: 'At a low load current (5 A), which device has the lower on-state voltage here?',
      options: ['The IGBT, at any current', 'The MOSFET: the IGBT’s knee voltage V0 dominates at low current', 'Both are the same'],
      answer: 1,
      explain: 'The IGBT’s on-state voltage starts at the knee V0 and adds only r·I; the MOSFET’s is Ron·I. Below I = V0/(Ron − r) the MOSFET conducts with less voltage; above it the IGBT wins.',
    },
    base: {},
    steps: [
      {
        title: '1 · On-state voltage at 20 A',
        at: (r) => r.params.toff - 0.3 * (r.params.toff - r.params.ton),
        window: (r) => [r.params.ton - 0.05 * (r.params.toff - r.params.ton), r.params.toff],
        channels: ['vce', 'vdsMos'],
        look: 'Compare the two flat on-state voltages.',
        body: (_st, m, r) => `IGBT: VCE(sat) = ${formatV(m.vceSat, false)} (V0 + r·I0). MOSFET of the same voltage class: ${formatV(m.mos.vdsOn, false)} (Ron·I0, Ron = ${formatSI(r.params.ronMos, 'Ω')}). Conduction loss ${formatSI(m.pcond, 'W')} vs ${formatSI(m.mos.pcond, 'W')} (SIMULATION).`,
      },
      {
        title: '2 · Turn-off side by side',
        at: (r) => t6(r) + 0.05 * r.params.tau,
        window: offWin,
        channels: ['ic', 'idMos', 'vce'],
        look: 'The MOSFET current falls to zero; the IGBT current stops at the tail.',
        body: (st, m) => `Same gate, same plateau timing: both voltages rise together. Then the MOSFET current is ${formatA(st.idMos)}, the IGBT still conducts ${formatA(st.ic)} — the tail (${formatA(m.itail0 ?? NaN)} at the knee).`,
      },
      {
        title: '3 · The bill: switching energy',
        at: (r) => r.params.tend - 0.05 * (r.params.tend - r.params.toff),
        window: (r) => [0, r.params.tend],
        channels: ['energy', 'energyMos'],
        look: 'Two staircases: the IGBT’s keeps climbing after turn-off.',
        body: (_st, m) => `Eon is similar (${formatSI(m.eon, 'J')} vs ${formatSI(m.mos.eon, 'J')}: same gate, same Miller charge). Eoff is ${formatSI(m.eoff, 'J')} vs ${formatSI(m.mos.eoff, 'J')} — ×${m.eoffRatio.toFixed(1)}, because of the tail.`,
      },
      {
        title: '4 · At a low current',
        params: { i0: 5 },
        at: (r) => r.params.toff - 0.3 * (r.params.toff - r.params.ton),
        window: (r) => [r.params.ton - 0.05 * (r.params.toff - r.params.ton), r.params.toff],
        channels: ['vce', 'vdsMos'],
        look: 'Now the MOSFET’s line is the lower one.',
        body: (_st, m) => `At 5 A: IGBT ${formatV(m.vceSat, false)}, MOSFET ${formatV(m.mos.vdsOn, false)}. The IGBT’s knee V0 cannot be avoided; the MOSFET’s voltage shrinks with the current. (SIMULATION)`,
      },
    ],
  },
]

export const IGBT_EXPERIMENTS: Array<Experiment<IgbtParams, IgbtMeasurements>> = [
  {
    id: 'tau',
    title: 'Double the carrier lifetime',
    change: (p) => ({ tau: p.tau * 2 }),
    question: (p) => `τ goes from ${formatTime(p.tau)} to ${formatTime(p.tau * 2)} (the same on-state). What happens to the turn-off energy?`,
    choices: ['Eoff grows a lot (a longer tail)', 'Eoff falls', 'Eoff stays about the same'],
    judge: (b, a) => (a.eoff / b.eoff > 1.3 ? 0 : a.eoff / b.eoff < 0.9 ? 1 : 2),
    rows: ['tauTail', 'itail0', 'etail', 'eoff', 'eoffMos'],
    why: (b, a) => `E_tail ${formatSI(b.etail, 'J')} → ${formatSI(a.etail, 'J')}: the tail starts at about the same current (${formatA(b.itail0 ?? NaN)} → ${formatA(a.itail0 ?? NaN)}) but lasts twice as long, so its charge and energy double. The fast part hardly changes (${formatSI(b.eoffMos, 'J')} → ${formatSI(a.eoffMos, 'J')}): the gate does not see the lifetime.`,
  },
  {
    id: 'rg',
    title: 'Double the gate resistance',
    change: (p) => ({ rg: p.rg * 2 }),
    question: (p) => `Rg goes from ${formatSI(p.rg, 'Ω')} to ${formatSI(p.rg * 2, 'Ω')}. What happens to Eoff?`,
    choices: ['It about doubles', 'It grows, but much less than ×2: the tail does not depend on Rg', 'It falls'],
    judge: (b, a) => (a.eoff / b.eoff > 1.7 ? 0 : a.eoff / b.eoff > 1.01 ? 1 : 2),
    rows: ['trv', 'eoffMos', 'etail', 'eoff'],
    why: (b, a) => `The fast part grows like the gate time constant (${formatSI(b.eoffMos, 'J')} → ${formatSI(a.eoffMos, 'J')}), but the tail (${formatSI(b.etail, 'J')} → ${formatSI(a.etail, 'J')}) is set by the stored holes and τ — no gate resistor can speed it up. Eoff ×${(a.eoff / b.eoff).toFixed(2)}.`,
  },
  {
    id: 'current',
    title: 'Quarter the load current: who conducts better?',
    change: (p) => ({ i0: p.i0 / 4 }),
    question: (p) => `I0 goes from ${formatA(p.i0)} to ${formatA(p.i0 / 4)}. Which device then has the lower conduction loss?`,
    choices: ['Still the IGBT', 'Now the MOSFET', 'They become equal'],
    judge: (_b, a) => (Math.abs(a.pcond / a.mosPcond - 1) < 0.02 ? 2 : a.pcond < a.mosPcond ? 0 : 1),
    rows: ['vceSat', 'pcond', 'mosVon', 'mosPcond'],
    why: (b, a) => `IGBT: ${formatV(b.vceSat, false)} → ${formatV(a.vceSat, false)} — the knee V0 stays. MOSFET: ${formatV(b.mosVon, false)} → ${formatV(a.mosVon, false)} — Ron·I shrinks with the current. Conduction loss now ${formatSI(a.pcond, 'W')} (IGBT) vs ${formatSI(a.mosPcond, 'W')} (MOSFET): the IGBT pays off only at high current.`,
  },
]

export function igbtPredictions(seed: number): Array<PredictTask<IgbtParams, IgbtMeasurements>> {
  const i0 = [10, 20, 40][seed % 3]
  const alpha = [0.2, 0.3, 0.4][(seed + 1) % 3]
  const tau = [100e-9, 200e-9, 400e-9][(seed + 2) % 3]
  return [
    {
      id: 'vce',
      prompt: `V0 = 0.8 V, r = 40 mΩ, I0 = ${i0} A. Predict the on-state voltage VCE(sat).`,
      params: { i0 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vceSat,
      tolerance: 0.03,
      hint: 'A knee voltage plus a resistive drop.',
      theory: (p) => `VCE(sat) = V0 + r·I0 = ${formatV(p.v0 + p.rce * p.i0, false)}`,
    },
    {
      id: 'itail',
      prompt: `The holes carry α = ${alpha} of the on-state current, I0 = 20 A. Predict the tail current when the channel closes (in A).`,
      params: { alpha },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.itail0 ?? NaN,
      tolerance: 0.06,
      hint: 'The gate removes only the electron part.',
      theory: (p) => `I_tail ≈ α·I0 = ${formatA(p.alpha * p.i0)} (the simulation is a little lower: the holes start to decay during the voltage rise)`,
    },
    {
      id: 'etail',
      prompt: `Vdc = 400 V, α = 0.3, I0 = 20 A, τ = ${formatTime(tau)}. Predict the tail energy (in µJ).`,
      params: { tau },
      kind: 'number',
      unit: 'µJ',
      answer: (m) => m.etail * 1e6,
      tolerance: 0.08,
      hint: 'Full voltage times the charge of an exponential: I_tail·τ.',
      theory: (p) => `E_tail ≈ Vdc·α·I0·τ = ${formatSI(p.vdc * p.alpha * p.i0 * p.tau, 'J')}`,
    },
    {
      id: 'who',
      prompt: 'Same gate, 400 V, 20 A. Which device loses more energy at turn-off?',
      params: {},
      kind: 'choice',
      choices: ['The IGBT', 'The MOSFET', 'About the same'],
      answer: (m) => (Math.abs(m.eoff / m.mosEoff - 1) < 0.1 ? 2 : m.eoff > m.mosEoff ? 0 : 1),
      hint: 'What keeps flowing after the IGBT’s channel is off?',
      theory: (p) => `IGBT: Eoff ≈ ½·Vdc·I0·(t_rv + t_fi) + Vdc·α·I0·τ; the tail term alone is ${formatSI(p.vdc * p.alpha * p.i0 * p.tau, 'J')}. MOSFET: only the first term.`,
    },
  ]
}

export { IGBT_DEFAULTS, measureIgbt }
