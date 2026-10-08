import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { channel, derived, exactMosfet, measureMosfet, MOSFET_DEFAULTS, textbookMosfet, vgAt, type MosfetMeasurements, type MosfetParams, type MosfetRun, type SwitchingTimes } from './mosfet.ts'

export { measureMosfet }

/** The phase of the switching transient at an instant (from the simulated mode and the gate drive). */
export type MosfetPhase = 'off' | 'turn-on delay' | 'current rise' | 'voltage fall (Miller plateau)' | 'on (ohmic)' | 'turn-off delay' | 'voltage rise (Miller plateau)' | 'current fall'

export interface MosfetState {
  k: number
  t: number
  vgs: number
  vds: number
  vg: number
  ig: number
  ich: number
  id: number
  idiode: number
  p: number
  energy: number
  region: 'cut' | 'sat' | 'ohm'
  diode: boolean
  phase: MosfetPhase
}

export function mosfetStateAt(r: MosfetRun, k: number): MosfetState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const t = r.time[i]
  const mode = r.modes[i]
  const s = r.signals
  const d = derived(p, s.vgs[i], s.vds[i], t, mode)
  const diode = mode.endsWith('|D')
  const gateHigh = vgAt(p, t - 1e-15) === p.vdrv
  let phase: MosfetPhase
  if (gateHigh) phase = d.region === 'cut' ? 'turn-on delay' : diode ? 'current rise' : d.region === 'sat' ? 'voltage fall (Miller plateau)' : 'on (ohmic)'
  else phase = d.region === 'ohm' ? 'turn-off delay' : !diode && d.region === 'sat' ? 'voltage rise (Miller plateau)' : diode && d.region === 'sat' ? 'current fall' : 'off'
  return { k: i, t, vgs: s.vgs[i], vds: s.vds[i], vg: d.vg, ig: d.ig, ich: d.ich, id: d.id, idiode: d.idiode, p: d.p, energy: s.energy[i], region: d.region, diode, phase }
}

export function mosfetView(st: MosfetState): StateView {
  return {
    badge: { text: st.phase, tone: st.phase === 'on (ohmic)' ? 'on' : st.phase === 'off' ? 'off' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'gate drive', v: formatV(st.vg) },
      { k: 'vGS', v: formatV(st.vgs) },
      { k: 'vDS', v: formatV(st.vds) },
      { k: 'iD (drain)', v: formatA(st.id) },
      { k: 'channel', v: st.region === 'cut' ? 'OFF (vGS ≤ Vth)' : st.region === 'sat' ? 'saturation: i = gm·(vGS − Vth)' : 'ohmic: i = vDS/Ron', full: true, tone: st.region === 'cut' ? 'off' : 'on-q' },
      { k: 'diode', v: st.diode ? `ON · ${formatA(st.idiode)}` : 'OFF', tone: st.diode ? 'on-d' : 'off' },
      { k: 'gate current', v: formatA(st.ig, true), min: 'standard' },
      { k: 'power in the device', v: formatSI(st.p, 'W'), min: 'standard' },
      { k: 'energy so far', v: formatSI(st.energy, 'J'), min: 'standard' },
      { k: 'channel current', v: formatA(st.ich), min: 'engineer' },
    ],
    path: st.diode ? `I0 → freewheeling diode (${formatA(st.idiode)})${st.ich > 1e-6 ? ` and channel (${formatA(st.ich)})` : ''}` : `I0 → MOSFET channel (${formatA(st.id)})`,
  }
}

export function mosfetWhy(r: MosfetRun, st: MosfetState, m: MosfetMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const tau = p.rg * p.ciss
  const phaseCard: Record<MosfetPhase, Omit<WhyCard, 'id' | 'question'>> = {
    off: {
      what: `vGS = ${formatV(st.vgs)} is below Vth = ${formatV(p.vth, false)}: the channel is off. The load current ${formatA(p.i0)} circulates through the freewheeling diode.`,
      why: 'Without a channel the drain is clamped by the diode at Vdc: the switch blocks the full voltage while carrying no current.',
      equation: 'i_ch = 0;  vDS = Vdc',
      physics: 'Zero current × full voltage: no power in the device.',
      whatIf: 'A negative gate-off level keeps vGS further from Vth: better noise immunity.',
    },
    'turn-on delay': {
      what: `The driver switched to ${formatV(p.vdrv, false)}, but vGS = ${formatV(st.vgs)} is still below Vth.`,
      why: `The driver must first charge Ciss = Cgs + Cgd = ${formatSI(p.ciss, 'F')} through Rg: an RC charge with τ = Rg·Ciss = ${formatTime(tau)}. Nothing happens in the power circuit until vGS reaches Vth.`,
      equation: 'td(on) = Rg·Ciss·ln((Vdrv − Voff)/(Vdrv − Vth))',
      physics: `Gate current now ${formatA(st.ig)}: all of it charges the gate capacitances.`,
      whatIf: 'A smaller Rg or a stronger driver shortens the delay.',
    },
    'current rise': {
      what: `vGS = ${formatV(st.vgs)} > Vth: the channel conducts ${formatA(st.ich)}, but vDS is still ${formatV(st.vds)}.`,
      why: `The diode still carries the rest of the load current (${formatA(st.idiode)}). As long as the diode conducts it clamps the drain at Vdc, so the voltage cannot fall: the current transfers first, at full voltage.`,
      equation: 'i_ch = gm·(vGS − Vth);  vDS = Vdc while i_D > 0',
      physics: `Full voltage AND growing current: the device dissipates ${formatSI(st.p, 'W')} right now — the first part of the turn-on loss.`,
      whatIf: 'A larger gm or a smaller load current shortens this phase.',
    },
    'voltage fall (Miller plateau)': {
      what: `The diode turned off; vDS falls (now ${formatV(st.vds)}) while vGS stays almost constant at ${formatV(st.vgs)} — the Miller plateau.`,
      why: `The channel must carry the full load current, which fixes vGS ≈ Vth + I0/gm. As vDS falls, the gate–drain capacitance Cgd must be discharged: nearly all of the gate current (${formatA(st.ig)}) goes into Cgd instead of raising vGS.`,
      equation: 'dvDS/dt ≈ −(Vdrv − Vpl)/(Rg·Cgd)  ⇒  t_fv ≈ Rg·Cgd·Vdc/(Vdrv − Vpl)',
      physics: `The plateau is ${formatV(m.plateau ?? NaN)} here, slightly above Vth + I0/gm = ${formatV(p.vpl, false)}: the channel must also sink the Cgd discharge current. Power now ${formatSI(st.p, 'W')}.`,
      whatIf: 'A larger Cgd (Miller capacitance) makes this the longest — and most lossy — part of the transition.',
    },
    'on (ohmic)': {
      what: `vDS = ${formatV(st.vds)}: the MOSFET is fully on, carrying ${formatA(st.id)}.`,
      why: 'Once vDS falls below the saturation limit the channel behaves as the resistance Ron; vGS is free to rise to the full drive voltage.',
      equation: `vDS = I0·Ron = ${formatV(p.i0 * p.ron, false)};  P = I0²·Ron = ${formatSI(p.i0 * p.i0 * p.ron, 'W')}`,
      physics: 'Low voltage × full current: only the conduction loss remains.',
      whatIf: 'A larger device (lower Ron) reduces the conduction loss but usually has larger capacitances — more switching loss.',
    },
    'turn-off delay': {
      what: `The driver dropped to ${formatV(p.voff)}, but the MOSFET still conducts fully (vDS = ${formatV(st.vds)}).`,
      why: 'vGS must first discharge from the full drive level down to the plateau before the channel starts to limit the current.',
      equation: 'td(off) = Rg·Ciss·ln((Vdrv − Voff)/(Vpl − Voff))',
      physics: 'This delay is wasted time: it is why fast drivers turn off with a negative voltage.',
      whatIf: 'A negative Voff discharges the gate faster (larger gate current).',
    },
    'voltage rise (Miller plateau)': {
      what: `vDS rises (now ${formatV(st.vds)}) at full load current while vGS sits on the plateau (${formatV(st.vgs)}).`,
      why: 'The load current must keep flowing and the diode cannot take it until vDS reaches Vdc. The gate current now charges Cgd the other way: the plateau again.',
      equation: 'dvDS/dt ≈ (Vpl − Voff)/(Rg·Cgd)  ⇒  t_rv ≈ Rg·Cgd·Vdc/(Vpl − Voff)',
      physics: `Full current and rising voltage: the largest part of the turn-off loss (power now ${formatSI(st.p, 'W')}).`,
      whatIf: 'A larger Rg slows this phase and increases Eoff — but reduces the voltage slope (EMI).',
    },
    'current fall': {
      what: `vDS reached Vdc, the diode conducts again and takes over the current; the channel current is falling (${formatA(st.ich)}).`,
      why: 'With the drain clamped, vGS can fall again; the channel current follows gm·(vGS − Vth) down to zero.',
      equation: 't_fi = Rg·Ciss·ln((Vpl − Voff)/(Vth − Voff))',
      physics: `Full voltage while the current falls: the second part of the turn-off loss. Eoff (SIMULATION) = ${formatSI(m.eoff, 'J')}.`,
      whatIf: 'A larger gm makes the channel current fall faster.',
    },
  }
  const pc = phaseCard[st.phase]
  cards.push({ id: 'phase', question: `What is happening now? (${st.phase})`, ...pc })
  cards.push({
    id: 'loss',
    question: 'Why do switching transitions cost energy?',
    what: `SIMULATION: Eon = ${formatSI(m.eon, 'J')}, Eoff = ${formatSI(m.eoff, 'J')} per switching cycle.`,
    why: 'During each transition the device sees a large voltage and a large current at the same time. Their product, integrated over the transition, is energy turned into heat in the switch.',
    equation: 'E = ∫ vDS·iD dt ≈ ½·Vdc·I0·(t_current + t_voltage)',
    physics: `At a switching frequency fs the switching loss is (Eon + Eoff)·fs: at 100 kHz that would be ${formatSI((m.eon + m.eoff) * 1e5, 'W')}, compared with the conduction loss ${formatSI(m.pcond, 'W')}.`,
    whatIf: 'Halving Rg roughly halves the transition times and the switching energy.',
  })
  return cards
}

/** SIMULATION vs THEORY (exact PWL solution) and the textbook formulas. */
export function compareMosfet(r: MosfetRun, m: MosfetMeasurements): CompareResult {
  const p = r.params
  const ex: SwitchingTimes = exactMosfet(p)
  const tb = textbookMosfet(p)
  const rows: CompareRow[] = []
  const exactNote = 'exact under this model (the Miller current does not matter in this phase)'
  const millerNote = `approximation: assumes vGS = Vth + I0/gm exactly; the channel also carries the Cgd current, so the true plateau is higher${p.cds > 0 ? ', and Cds is ignored' : ''}`
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tbv: number, formula: string, note: string) => {
    if (sim === null || exact === null) return
    const error = Math.abs(sim - exact) / Math.max(Math.abs(exact), 1e-30)
    const textbook: TextbookValue = { key, value: tbv, formula, assumptions: [note] }
    rows.push({ key, label, unit, sim, exact, error, tolerance: 0.005, pass: error <= 0.005, textbook, textbookError: (sim - tbv) / Math.abs(tbv) })
  }
  add('tdOn', 'Turn-on delay td(on)', 's', m.tdOn, ex.tdOn, tb.tdOn, 'Rg·Ciss·ln((Vdrv − Voff)/(Vdrv − Vth))', exactNote)
  add('tri', 'Current rise t_ri', 's', m.tri, ex.tri, tb.tri, 'Rg·Ciss·ln((Vdrv − Vth)/(Vdrv − Vpl))', 'approximation: ends when i_ch = I0; the diode actually releases when i_ch = I0 + Cgd·dvGS/dt')
  add('tfv', 'Voltage fall t_fv', 's', m.tfv, ex.tfv, tb.tfv, 'Rg·Cgd·(Vdc − I0·Ron)/(Vdrv − Vpl)', millerNote)
  add('tdOff', 'Turn-off delay td(off)', 's', m.tdOff, ex.tdOff, tb.tdOff, 'Rg·Ciss·ln((Vdrv − Voff)/(Vpl − Voff))', 'approximation: ends at the textbook plateau')
  add('trv', 'Voltage rise t_rv', 's', m.trv, ex.trv, tb.trv, 'Rg·Cgd·(Vdc − I0·Ron)/(Vpl − Voff)', millerNote)
  add('tfi', 'Current fall t_fi', 's', m.tfi, ex.tfi, tb.tfi, 'Rg·Ciss·ln((Vpl − Voff)/(Vth − Voff))', 'approximation: starts from the textbook plateau')
  add('eon', 'Turn-on energy Eon', 'J', m.eon, ex.eon, tb.eon, '½·Vdc·I0·(t_ri + t_fv)', 'approximation: linear current and voltage ramps')
  add('eoff', 'Turn-off energy Eoff', 'J', m.eoff, ex.eoff, tb.eoff, '½·Vdc·I0·(t_rv + t_fi)', 'approximation: linear current and voltage ramps')
  add('plateau', 'Miller plateau voltage', 'V', m.plateau, ex.plateau, tb.vpl, 'Vpl = Vth + I0/gm', 'approximation: ignores the Cgd discharge current in the channel')
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: 'SIMULATION: trapezoidal time-stepping of the double-pulse circuit with every region change located exactly. THEORY: the exact piecewise-linear solution (matrix exponential) of the same circuit; Textbook: the classical phase formulas.',
  }
}

export function mosfetEventLabel(e: RunEvent): string {
  if (e.kind === 'gate-on') return 'Gate driver switches high'
  if (e.kind === 'gate-off') return 'Gate driver switches low'
  const [from, to] = (e.device ?? '').split('→')
  if (from?.startsWith('cut') && to?.startsWith('sat')) return 'vGS reaches Vth: channel starts to conduct'
  if (from?.endsWith('|D') && to?.endsWith('|off')) return 'Diode releases: the channel carries the full load current'
  if (from?.startsWith('sat') && to?.startsWith('ohm')) return 'vDS collapses: the channel becomes ohmic'
  if (from?.startsWith('ohm') && to?.startsWith('sat')) return 'Channel leaves the ohmic region (plateau reached)'
  if (from?.endsWith('|off') && to?.endsWith('|D')) return 'vDS reaches Vdc: the diode takes the current back'
  if (from?.startsWith('sat') && to?.startsWith('cut')) return 'vGS falls below Vth: channel off'
  return e.device ?? e.kind
}
export function mosfetEventWhy(e: RunEvent): string {
  return `At this instant vGS = ${formatV(e.values.vgs ?? 0)}, vDS = ${formatV(e.values.vds ?? 0)}, iD = ${formatA(e.values.id ?? 0)}. The circuit equations change form here — a new phase of the transition begins.`
}

export const MOSFET_LESSONS: Array<Lesson<MosfetParams, MosfetRun, MosfetMeasurements, MosfetState>> = [
  {
    id: 'turnon',
    title: 'Turn-on in four phases',
    summary: 'Delay, current rise, Miller plateau, ohmic — and where the energy is lost.',
    base: {},
    steps: [
      {
        title: '1 · Delay: charging the gate',
        at: (r) => r.params.ton + 0.5 * (measureMosfet(r).tdOn ?? 0),
        window: (r) => [r.params.ton - 0.1 * (r.params.toff - r.params.ton), r.params.ton + 0.45 * (r.params.toff - r.params.ton)],
        channels: ['vg', 'vgs', 'vds', 'id'],
        look: 'vGS rises exponentially; vDS and iD do not move yet.',
        body: (st, m, r) => `The driver is at ${formatV(r.params.vdrv, false)} but vGS = ${formatV(st.vgs)} — still below Vth = ${formatV(r.params.vth, false)}. It charges Ciss through Rg; this delay lasts ${formatTime(m.tdOn ?? NaN)} (SIMULATION).`,
      },
      {
        title: '2 · Current rise at full voltage',
        at: (r) => r.params.ton + (measureMosfet(r).tdOn ?? 0) + 0.5 * (measureMosfet(r).tri ?? 0),
        window: (r) => [r.params.ton - 0.1 * (r.params.toff - r.params.ton), r.params.ton + 0.45 * (r.params.toff - r.params.ton)],
        channels: ['vgs', 'vds', 'id', 'idiode'],
        look: 'iD rises while the diode current falls; vDS stays at Vdc.',
        body: (st) => `The channel already carries ${formatA(st.ich)}, the diode the remaining ${formatA(st.idiode)} — and as long as the diode conducts, the drain is clamped at ${formatV(st.vds)}.`,
      },
      {
        title: '3 · The Miller plateau',
        at: (r) => {
          const m = measureMosfet(r)
          return r.params.ton + (m.tdOn ?? 0) + (m.tri ?? 0) + 0.5 * (m.tfv ?? 0)
        },
        window: (r) => [r.params.ton - 0.1 * (r.params.toff - r.params.ton), r.params.ton + 0.45 * (r.params.toff - r.params.ton)],
        channels: ['vgs', 'vds', 'id', 'ig'],
        look: 'vGS stays flat while vDS falls.',
        body: (st, m) => `vDS falls (now ${formatV(st.vds)}) while vGS is stuck at ≈ ${formatV(m.plateau ?? NaN)}: the gate current ${formatA(st.ig)} goes into discharging Cgd. This phase takes ${formatTime(m.tfv ?? NaN)}.`,
      },
      {
        title: '4 · Where the energy went',
        at: (r) => r.params.ton + 0.4 * (r.params.toff - r.params.ton),
        window: (r) => [r.params.ton - 0.1 * (r.params.toff - r.params.ton), r.params.ton + 0.45 * (r.params.toff - r.params.ton)],
        channels: ['vds', 'id', 'pdev', 'energy'],
        look: 'The power pulse sits in phases 2 and 3; the energy curve steps up there.',
        body: (_st, m) => `The device dissipated Eon = ${formatSI(m.eon, 'J')} — almost all during the current rise and the voltage fall, when voltage and current overlapped. The textbook estimate ½·Vdc·I0·(t_ri + t_fv) assumes straight ramps.`,
      },
    ],
  },
]

export const MOSFET_EXPERIMENTS: Array<Experiment<MosfetParams, MosfetMeasurements>> = [
  {
    id: 'rg',
    title: 'Double the gate resistance',
    change: (p) => ({ rg: p.rg * 2 }),
    question: (p) => `Rg goes from ${formatSI(p.rg, 'Ω')} to ${formatSI(p.rg * 2, 'Ω')}. What happens to the switching energy?`,
    choices: ['About doubles', 'About halves', 'Unchanged'],
    judge: (b, a) => (a.eon / b.eon > 1.6 ? 0 : a.eon / b.eon < 0.7 ? 1 : 2),
    rows: ['tri', 'tfv', 'eon', 'eoff'],
    why: (b, a) => `Eon ${formatSI(b.eon, 'J')} → ${formatSI(a.eon, 'J')}, Eoff ${formatSI(b.eoff, 'J')} → ${formatSI(a.eoff, 'J')}. Every transition time is an Rg·C time constant, so a slower gate charge stretches the overlap of voltage and current — at the same voltage and current.`,
  },
  {
    id: 'cgd',
    title: 'Triple the Miller capacitance',
    change: (p) => ({ cgd: p.cgd * 3 }),
    question: () => 'Cgd triples. Which phase grows the most?',
    choices: ['The voltage transitions (Miller plateau)', 'The turn-on delay', 'The current rise'],
    judge: (b, a) => {
      const g = [(a.tfv ?? 0) / (b.tfv ?? 1), (a.tdOn ?? 0) / (b.tdOn ?? 1), (a.tri ?? 0) / (b.tri ?? 1)]
      return g.indexOf(Math.max(...g))
    },
    rows: ['tdOn', 'tri', 'tfv', 'trv'],
    why: (b, a) => `t_fv ${formatTime(b.tfv ?? NaN)} → ${formatTime(a.tfv ?? NaN)}, t_rv ${formatTime(b.trv ?? NaN)} → ${formatTime(a.trv ?? NaN)}: on the plateau the gate current goes into Cgd, so the voltage slope is set by Cgd. The delay and current rise only grow with Ciss = Cgs + Cgd (a little).`,
  },
  {
    id: 'current',
    title: 'Triple the load current',
    change: (p) => ({ i0: p.i0 * 3 }),
    question: () => 'I0 triples. What happens to the Miller plateau?',
    choices: ['It rises', 'It falls', 'It stays the same'],
    judge: (b, a) => ((a.plateau ?? 0) > (b.plateau ?? 0) * 1.02 ? 0 : (a.plateau ?? 0) < (b.plateau ?? 0) * 0.98 ? 1 : 2),
    rows: ['plateau', 'tri', 'tfv', 'eon'],
    why: (b, a) => `Plateau ${formatV(b.plateau ?? NaN)} → ${formatV(a.plateau ?? NaN)}: to carry I0 the channel needs vGS = Vth + I0/gm. A higher plateau leaves less drive (Vdrv − Vpl) to discharge Cgd, so the voltage fall slows, while the current rise takes longer too: Eon ${formatSI(b.eon, 'J')} → ${formatSI(a.eon, 'J')}.`,
  },
]

export function mosfetPredictions(seed: number): Array<PredictTask<MosfetParams, MosfetMeasurements>> {
  const rg = [2, 5, 10][seed % 3]
  const i0 = [5, 10, 20][(seed + 1) % 3]
  return [
    {
      id: 'tdon',
      prompt: `Rg = ${rg} Ω, Ciss = 1.6 nF, Vdrv = 12 V, Vth = 3 V. Predict the turn-on delay.`,
      params: { rg },
      kind: 'number',
      unit: 's',
      answer: (m) => m.tdOn ?? NaN,
      tolerance: 0.03,
      hint: 'An RC charge from 0 towards 12 V until it reaches 3 V.',
      theory: (p) => `td(on) = Rg·Ciss·ln(Vdrv/(Vdrv − Vth)) = ${formatTime(p.rg * (p.cgs + p.cgd) * Math.log(p.vdrv / (p.vdrv - p.vth)))}`,
    },
    {
      id: 'plateau',
      prompt: `gm = 10 S, Vth = 3 V, I0 = ${i0} A. Predict the Miller plateau voltage.`,
      params: { i0 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.plateau ?? NaN,
      tolerance: 0.05,
      hint: 'What gate voltage lets the channel carry the whole load current?',
      theory: (p) => `Vpl ≈ Vth + I0/gm = ${formatV(p.vth + p.i0 / p.gm, false)} (the simulation is slightly higher: the channel also carries the Cgd current)`,
    },
  ]
}

export { MOSFET_DEFAULTS, channel }
