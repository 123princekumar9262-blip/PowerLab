import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, StatusInfo, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { exactGan, ganDerived, ganSystem, ganVg, hsGateOn, measureGan, textbookGan, type GanMeasurements, type GanParams, type GanRun, type HsMode } from './gan.ts'
import { siParts } from './igbt-content.ts'

export type GanPhase =
  | 'high side on (synchronous)'
  | 'dead time: node rising'
  | 'dead time: reverse conduction'
  | 'turn-on delay'
  | 'current rise'
  | 'voltage fall'
  | 'on (ohmic)'
  | 'turn-off delay'
  | 'voltage rise'
  | 'current fall'
  | 'shoot-through'

export interface GanState {
  k: number
  t: number
  vgs: number
  vds: number
  vg: number
  ig: number
  ich: number
  id: number
  iF: number
  vsd: number
  hsGate: boolean
  hs: HsMode
  region: 'cut' | 'sat' | 'ohm'
  pls: number
  phs: number
  els: number
  ehs: number
  phase: GanPhase
}

export function ganStateAt(r: GanRun, k: number): GanState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const t = r.time[i]
  const mode = r.modes[i]
  const s = r.signals
  const d = ganDerived(p, ganSystem(p), s.vgs[i], s.vds[i], t, mode)
  const lsHigh = ganVg(p, t - 1e-15) === p.vdrv
  const hsG = hsGateOn(p, t - 1e-15)
  let phase: GanPhase
  if (hsG && d.region !== 'cut' && d.iF < -0.05 * p.i0) phase = 'shoot-through'
  else if (hsG) phase = 'high side on (synchronous)'
  else if (lsHigh) phase = d.region === 'cut' ? 'turn-on delay' : d.region === 'ohm' ? 'on (ohmic)' : d.hs === 'rev' ? 'current rise' : 'voltage fall'
  else if (d.region === 'ohm') phase = 'turn-off delay'
  else if (d.hs === 'rev') phase = d.region === 'sat' ? 'current fall' : 'dead time: reverse conduction'
  else phase = t < p.ton ? 'dead time: node rising' : 'voltage rise'
  return { k: i, t, vgs: s.vgs[i], vds: s.vds[i], vg: d.vg, ig: d.ig, ich: d.ich, id: d.id, iF: d.iF, vsd: d.vsd, hsGate: hsG, hs: d.hs, region: d.region, pls: d.pls, phs: d.phs, els: s.els[i], ehs: s.ehs[i], phase }
}

const hsText = (st: GanState) => (st.hs === 'on' ? 'ON — channel conducts (synchronous)' : st.hs === 'rev' ? 'OFF — but conducting in reverse' : 'OFF — blocking')

export function ganView(st: GanState): StateView {
  return {
    badge: { text: st.phase, tone: st.phase === 'on (ohmic)' ? 'on' : st.phase.startsWith('high side') ? 'off' : st.phase === 'shoot-through' ? 'neutral' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'low-side gate', v: formatV(st.vg) },
      { k: 'high-side gate', v: st.hsGate ? 'ON' : 'OFF', tone: st.hsGate ? 'on-q' : 'off' },
      { k: 'vDS (low side)', v: formatV(st.vds) },
      { k: 'iD (low side)', v: formatA(st.id, true) },
      { k: 'high side', v: hsText(st), full: true, tone: st.hs === 'rev' ? 'on-d' : st.hs === 'on' ? 'on-q' : 'off' },
      { k: 'iHS (reverse)', v: formatA(st.iF, true) },
      { k: 'vSD (high side)', v: formatV(st.vsd) },
      { k: 'low-side power', v: formatSI(st.pls, 'W'), min: 'standard' },
      { k: 'high-side power', v: formatSI(st.phs, 'W'), min: 'standard' },
      { k: 'vGS (low side)', v: formatV(st.vgs), min: 'standard' },
      { k: 'channel current', v: formatA(st.ich), min: 'engineer' },
    ],
    path: st.hs !== 'off' && Math.abs(st.iF) > 1e-3 ? `I0 → high side (${st.hs === 'rev' ? 'reverse, gate off' : 'channel'}) ${formatA(st.iF)}${Math.abs(st.id) > 1e-3 ? ` · low side ${formatA(st.id, true)}` : ''}` : `I0 → low side ${formatA(st.id, true)}`,
  }
}

export function ganStatus(st: GanState): StatusInfo {
  const facts: string[] = []
  if (st.hs === 'rev') facts.push(`high side in reverse: vSD ${formatV(st.vsd, false)}`, `${formatA(st.iF)} · ${formatSI(st.phs, 'W')}`)
  else if (st.hs === 'on') facts.push(`high side ON: vSD ${formatV(st.vsd)}`, `${formatA(st.iF, true)}`)
  else facts.push(`vDS ${formatV(st.vds, false)}`, `iD ${formatA(st.id, true)}`)
  return { headline: st.phase.charAt(0).toUpperCase() + st.phase.slice(1), facts, tone: st.phase === 'on (ohmic)' ? 'on' : st.phase.startsWith('high side') ? 'off' : 'idle' }
}

export function ganWhy(r: GanRun, st: GanState, m: GanMeasurements): WhyCard[] {
  const p = r.params
  const vsdTh = p.vth - p.voff + p.ron * p.i0
  const card: Record<GanPhase, Omit<WhyCard, 'id' | 'question'>> = {
    'high side on (synchronous)': {
      what: `The high-side HEMT's gate is ON: it carries the load current ${formatA(st.iF)} in reverse through its channel with only vSD = ${formatV(st.vsd)}.`,
      why: 'A HEMT channel conducts in both directions when its gate is on: it is just a resistor Ron. Using the switch itself as the freewheeling path is synchronous rectification.',
      equation: `vSD = Ron·I0 = ${formatV(p.ron * p.i0, false)}`,
      physics: `High-side loss now ${formatSI(st.phs, 'W')} (I0²·Ron).`,
      whatIf: 'Any time this gate is off, the drop jumps to Vth − Voff + Ron·I0 — the dead-time penalty.',
    },
    'dead time: node rising': {
      what: `Both gates are off and the high side has not started to conduct: the load current charges the switch node (vDS = ${formatV(st.vds)}).`,
      why: `With the high side's channel closed, the inductor current flows into the node capacitance until vSD reaches Vth − Voff = ${formatV(p.vf, false)}: then the high-side channel opens in reverse.`,
      equation: 'Cn·dvDS/dt = I0  until  vDS = Vdc + Vth − Voff',
      physics: 'This takes picoseconds to a nanosecond: the node capacitance is small.',
      whatIf: 'A larger node capacitance or a smaller current slows it.',
    },
    'dead time: reverse conduction': {
      what: `Both gates are OFF, yet the high side carries ${formatA(st.iF)} in reverse with vSD = ${formatV(st.vsd)}.`,
      why: `A GaN HEMT has no body diode. With the gate off it still conducts backwards once its gate–drain voltage exceeds Vth: the drop is Vth − vGS(off) = ${formatV(p.vth, false)} − (${formatV(p.voff)}) plus Ron·I.`,
      equation: `vSD = Vth − Voff + Ron·I0 = ${formatV(vsdTh, false)}`,
      physics: `That is ${(vsdTh / Math.max(1e-9, p.ron * p.i0)).toFixed(1)}× the synchronous drop: ${formatSI(st.phs, 'W')} instead of ${formatSI(p.ron * p.i0 * p.i0, 'W')}. The two dead times cost ${formatSI(m.edead, 'J')} per cycle (SIMULATION).`,
      whatIf: p.voff < 0 ? 'The negative off-voltage adds directly to the drop: use 0 V off if the layout allows it.' : 'A negative off-voltage (−3 V) would add 3 V to this drop.',
    },
    'turn-on delay': {
      what: `The low-side driver is at ${formatV(p.vdrv, false)}; vGS = ${formatV(st.vgs)} is still below Vth = ${formatV(p.vth, false)} — the high side keeps conducting in reverse.`,
      why: `The tiny input capacitance (${formatSI(p.ciss, 'F')}) charges through Rg in τ = ${formatTime(p.rg * p.ciss)}: the reverse conduction lasts the dead time PLUS this delay.`,
      equation: 'td(on) = Rg·Ciss·ln((Vdrv − Voff)/(Vdrv − Vth))',
      physics: `The gate swing is only ${formatV(p.vdrv - p.voff, false)}: GaN gates are damaged above about +7 V.`,
      whatIf: 'A smaller Rg shortens the delay — and the reverse conduction.',
    },
    'current rise': {
      what: `The low side takes over: iD = ${formatA(st.id, true)}, the high side still carries ${formatA(st.iF)} and vDS stays at Vdc + vSD.`,
      why: 'As long as the high side conducts, it clamps the node. Its current simply falls to zero: there are no stored minority carriers, so there is no reverse-recovery current.',
      equation: 'iHS = I0 − iD → 0,  Qrr = 0',
      physics: `Lowest high-side current during the turn-on: ${formatA(m.iFmin, true)} (SIMULATION) — no negative spike.`,
      whatIf: 'A silicon body diode here would drive a reverse-recovery spike into the low side.',
    },
    'voltage fall': {
      what: `The high side has stopped; vDS falls (now ${formatV(st.vds)}) at ${m.dvdtOn === null ? '—' : (m.dvdtOn / 1e9).toFixed(0)} V/ns.`,
      why: `Instead of a recovery charge, the low side must charge the high side's output capacitance and discharge its own: iD = ${formatA(st.id, true)} exceeds the load current.`,
      equation: 'iD = I0 + Coss,HS·|dvDS/dt|;  Q = Coss,HS·(Vdc + vSD)',
      physics: `Extra charge ${formatSI(m.qoss, 'C')} (SIMULATION) — this, not recovery, sets GaN's turn-on loss Eon = ${formatSI(m.eon, 'J')}.`,
      whatIf: 'Soft switching (letting the load current discharge the node first) removes this loss.',
    },
    'on (ohmic)': {
      what: `The low side is fully on: vDS = ${formatV(st.vds)} at ${formatA(st.id, true)}.`,
      why: 'The channel behaves as Ron; the high side blocks the full voltage with its gate off.',
      equation: `vDS = I0·Ron = ${formatV(p.i0 * p.ron, false)}`,
      physics: `Conduction loss ${formatSI(p.i0 * p.i0 * p.ron, 'W')}.`,
      whatIf: 'GaN Ron rises after high-voltage switching (current collapse) — not in this model.',
    },
    'turn-off delay': {
      what: `The low-side gate is off but vGS = ${formatV(st.vgs)} has not reached the plateau: the channel still conducts fully.`,
      why: 'The gate must discharge from the drive level to the plateau first.',
      equation: 'td(off) = Rg·Ciss·ln((Vdrv − Voff)/(Vpl − Voff))',
      physics: `Short: τ = ${formatTime(p.rg * p.ciss)}.`,
      whatIf: 'A strong turn-off path (small Rg) keeps the dead time needed short.',
    },
    'voltage rise': {
      what: `vDS rises (now ${formatV(st.vds)}); the low-side channel carries ${formatA(st.ich)}, the rest of I0 charges the node capacitance.`,
      why: 'With a fast gate the channel closes before the voltage has risen: the load current itself charges the capacitances — a nearly loss-free turn-off.',
      equation: 'Cn·dvDS/dt = I0 − i_ch',
      physics: `Eoff = ${formatSI(m.eoff, 'J')} (SIMULATION), part of it stored in the low side's own Coss.`,
      whatIf: 'If the dead time is shorter than this rise, the high side turns on into a node below Vdc: shoot-through.',
    },
    'current fall': {
      what: `vDS reached Vdc + vSD: the high side conducts in reverse (${formatA(st.iF)}) and the low-side channel current falls.`,
      why: 'The high side clamps the node; the low side’s current falls as vGS drops to Vth.',
      equation: 'i_ch = gm·(vGS − Vth)',
      physics: `Reverse conduction then continues until the dead time ends (${formatTime(m.trevOff ?? NaN)} after the clamp).`,
      whatIf: 'A shorter dead time cuts this reverse conduction short.',
    },
    'shoot-through': {
      what: `The high-side gate turned on while the low side still conducts: ${formatA(-st.iF)} flows straight from Vdc through both devices.`,
      why: 'The dead time was shorter than the low side’s turn-off. Both channels are on: only their resistances limit the current here (in a real circuit the loop inductance limits it, but the energy is still destructive).',
      equation: 'i ≈ (Vdc − vDS)/Ron,HS',
      physics: `Eoff (low side) = ${formatSI(m.eoff, 'J')} — far above a clean turn-off.`,
      whatIf: 'Make the dead time longer than td(off) + the voltage-rise time.',
    },
  }
  const cards: WhyCard[] = [{ id: 'phase', question: `What is happening now? (${st.phase})`, ...card[st.phase] }]
  cards.push({
    id: 'nodiode',
    question: 'How can a GaN HEMT freewheel without a body diode?',
    what: `SIMULATION: in the dead time the high side drops ${formatV(m.vsdRev, false)} (synchronous: ${formatV(m.vsdSync, false)}); its reverse conduction costs ${formatSI(m.edead, 'J')} per cycle.`,
    why: 'The HEMT channel is a two-dimensional electron gas between two symmetric contacts. Which terminal acts as the "source" depends on the voltage: driven backwards, the drain becomes the source, and the channel opens once the gate is Vth above it.',
    equation: 'vSD = Vth − vGS(off) + Ron·I',
    physics: 'No p-n junction means no minority carriers: no reverse recovery (Qrr = 0). But the drop is 2–5 V instead of a silicon diode’s ~0.8 V, so dead time is expensive.',
    whatIf: 'Shorter dead time or a 0 V off-level cuts the loss; too short a dead time risks shoot-through.',
  })
  return cards
}

/** SIMULATION vs THEORY (exact PWL solution) and the closed-form relations. */
export function compareGan(r: GanRun, m: GanMeasurements): CompareResult {
  const p = r.params
  const ex = exactGan(p)
  const tb = textbookGan(p)
  const rows: CompareRow[] = []
  const shoot = m.shootThrough > 0
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tbv: number | null, formula: string, note: string, expected?: string) => {
    if (sim === null || exact === null || !Number.isFinite(sim) || !Number.isFinite(exact)) return
    const error = Math.abs(sim - exact) / Math.max(Math.abs(exact), 1e-30)
    const textbook: TextbookValue | null = tbv === null ? null : { key, value: tbv, formula, assumptions: [note] }
    rows.push({ key, label, unit, sim, exact, error, tolerance: 0.005, pass: error <= 0.005, textbook, textbookError: tbv ? (sim - tbv) / Math.abs(tbv) : null, expected })
  }
  const vsdF = 'Vth − Voff + Ron·I0'
  add('vsdRev', 'Reverse drop in the dead time vSD', 'V', m.vsdRev, ex.vsdRev, tb.vsdRev, vsdF, 'exact once the node has settled (a picosecond time constant Ron·Cn)')
  add('vsdSync', 'Synchronous drop (high side ON)', 'V', m.vsdSync, ex.vsdSync, tb.vsdSync, 'Ron·I0', 'exact: the channel is a resistor')
  add('tdOn', 'Turn-on delay td(on)', 's', m.tdOn, ex.tdOn, tb.tdOn, 'Rg·Ciss·ln((Vdrv − Voff)/(Vdrv − Vth))', 'approximation: ignores the small Cgd current while the node is clamped')
  add('tri', 'Current rise t_ri', 's', m.tri, ex.tri, null, '', '')
  add('tfv', 'Voltage fall t_fv', 's', m.tfv, ex.tfv, null, '', '')
  add('tdOff', 'Turn-off delay td(off)', 's', m.tdOff, ex.tdOff, null, '', '')
  add('trv', 'Voltage rise t_rv', 's', m.trv, ex.trv, null, '', '')
  add('trevOn', 'Reverse conduction before turn-on', 's', m.trevOn, ex.trevOn, p.tdead, 't_dead', 'approximation: the reverse conduction also lasts the turn-on delay and the current rise')
  add('trevOff', 'Reverse conduction after turn-off', 's', m.trevOff, ex.trevOff, p.tdead, 't_dead', 'approximation: the node needs td(off) + t_rv before the high side conducts')
  add('erevOn', 'Reverse-conduction energy, before turn-on', 'J', m.erevOn, ex.erevOn, tb.erevDead, '(Vth − Voff + Ron·I0)·I0·t_dead', 'approximation: the full current for exactly one dead time')
  add('erevOff', 'Reverse-conduction energy, after turn-off', 'J', m.erevOff, ex.erevOff, tb.erevDead, '(Vth − Voff + Ron·I0)·I0·t_dead', 'approximation: the full current for exactly one dead time')
  add('qoss', 'Extra charge at turn-on (no Qrr)', 'C', m.qoss, ex.qoss, tb.qoss, 'Coss,HS·(Vdc + Vth − Voff)', 'approximation: the high side’s output charge, swung to 0 V')
  add('eon', 'Turn-on energy Eon', 'J', m.eon, ex.eon, null, '', '')
  add('eoff', 'Turn-off energy Eoff', 'J', m.eoff, ex.eoff, null, '', '', shoot ? 'shoot-through: the high side turns on into the conducting low side — a picosecond current spike limited only by Ron that the fixed time step does not resolve' : undefined)
  return {
    rows,
    allPass: rows.every((x) => x.pass || !!x.expected),
    header:
      'SIMULATION: trapezoidal time-stepping of the half-bridge (state vGS, vDS of the low side) with every region change of both HEMTs located exactly. THEORY: the exact piecewise-linear solution (matrix exponential) of the same circuit; the static drops in closed form.',
    note: shoot ? `Shoot-through: the high side conducts forward up to ${formatA(m.shootThrough)} — the dead time (${formatTime(p.tdead)}) is shorter than the low side's turn-off.` : undefined,
  }
}

export function ganEventLabel(e: RunEvent): string {
  if (e.device === 'high-side driver') return e.kind === 'gate-off' ? 'High-side gate OFF: the dead time begins' : 'High-side gate ON: synchronous conduction'
  if (e.kind === 'gate-on') return 'Low-side gate driver switches high'
  if (e.kind === 'gate-off') return 'Low-side gate driver switches low'
  const [from, to] = (e.device ?? '').split('→')
  const [rf, hf] = (from ?? '').split('|')
  const [rt, ht] = (to ?? '').split('|')
  if (hf !== ht) {
    if (ht === 'rev') return 'High side starts conducting in reverse (gate off, vSD = Vth − Voff)'
    if (hf === 'rev' && ht === 'off') return 'High-side current reaches zero — no reverse recovery'
    if (ht === 'on') return 'High side turns on'
    if (ht === 'off') return 'High side stops conducting'
  }
  if (rf === 'cut' && rt === 'sat') return 'Low-side vGS reaches Vth: its channel conducts'
  if (rf === 'sat' && rt === 'ohm') return 'vDS collapses: the low side is ohmic'
  if (rf === 'ohm' && rt === 'sat') return 'Low side leaves the ohmic region'
  if (rt === 'cut') return 'Low-side vGS falls below Vth: channel off'
  return e.device ?? e.kind
}
export function ganEventWhy(e: RunEvent): string {
  return `At this instant vGS = ${formatV(e.values.vgs ?? 0)}, vDS = ${formatV(e.values.vds ?? 0)}, iD = ${formatA(e.values.id ?? 0, true)}, high-side current ${formatA(e.values.iF ?? 0, true)}. The circuit equations change form here.`
}

export function ganReadings(m: GanMeasurements, r: GanRun): Reading[] {
  const p = r.params
  return [
    { id: 'vsd', label: 'High-side drop in the dead time', value: Number.isFinite(m.vsdRev) ? m.vsdRev.toFixed(2) : '—', unit: 'V', note: `vSD = Vth − Voff + Ron·I0; with the gate ON only ${formatV(m.vsdSync, false)}` },
    { id: 'edead', label: 'Dead-time loss per cycle', ...siParts(m.edead, 'J'), note: `two dead times of ${formatTime(p.tdead)}; at 100 kHz ${formatSI(m.edead * 1e5, 'W')}` },
    { id: 'eon', label: 'Turn-on energy (low side)', ...siParts(m.eon, 'J'), note: `no Qrr: the extra charge is the high side's Coss, ${formatSI(m.qoss, 'C')}`, min: 'standard' },
    { id: 'dvdt', label: 'Switching speed, turn-on', value: m.dvdtOn === null ? '—' : (m.dvdtOn / 1e9).toFixed(0), unit: 'V/ns', note: `the full swing in ${formatTime(m.tfv ?? NaN)}`, min: 'standard' },
  ]
}

const deadWin = (r: GanRun): [number, number] => [0, r.params.toff]
const onWin = (r: GanRun): [number, number] => [r.params.ton - 0.4 * r.params.tdead - 1e-9, r.params.ton + 0.45 * (r.params.toff - r.params.ton)]
const G = (r: GanRun) => measureGan(r)

export const GAN_LESSONS: Array<Lesson<GanParams, GanRun, GanMeasurements, GanState>> = [
  {
    id: 'reverse',
    title: 'Reverse conduction without a body diode',
    summary: 'In the dead time a GaN HEMT conducts backwards — with a drop set by its gate voltage.',
    check: {
      question: 'With the high-side gate held at −3 V instead of 0 V, its drop in the dead time…',
      options: ['falls by about 3 V', 'rises by about 3 V', 'stays the same'],
      answer: 1,
      explain: 'The reverse channel opens when the gate is Vth above the drain, so vSD = Vth − vGS(off) + Ron·I: every volt of negative off-voltage adds a volt to the drop — and to the dead-time loss.',
    },
    base: {},
    steps: [
      {
        title: '1 · The high side ON: a resistor',
        at: (r) => 0.5 * r.params.thsOff,
        window: deadWin,
        channels: ['vsd', 'iF', 'vds'],
        look: 'The high side carries the load current with a tiny drop.',
        body: (st, m) => `The high-side gate is ON: it carries ${formatA(st.iF)} backwards through its channel with vSD = ${formatV(m.vsdSync, false)} = Ron·I0 (SIMULATION).`,
      },
      {
        title: '2 · Dead time: the gate is off, the current is not',
        at: (r) => 0.5 * (r.params.thsOff + r.params.ton),
        window: deadWin,
        channels: ['vsd', 'iF', 'vds'],
        look: 'vSD jumps up when the high-side gate turns off — the current keeps flowing.',
        body: (st, m, r) => `Both gates are off for ${formatTime(r.params.tdead)}. Without a body diode the HEMT still conducts ${formatA(st.iF)} in reverse — but its drop is now ${formatV(m.vsdRev, false)}: Vth − Voff + Ron·I0.`,
      },
      {
        title: '3 · A negative off-voltage makes it worse',
        params: { voff: -3 },
        at: (r) => 0.5 * (r.params.thsOff + r.params.ton),
        window: deadWin,
        channels: ['vsd', 'iF', 'vds'],
        look: 'The same dead time, a 3 V higher drop.',
        body: (_st, m) => `Gate off at −3 V: vSD = ${formatV(m.vsdRev, false)} (SIMULATION). The reverse channel opens only when the gate is Vth above the drain, so the negative gate voltage adds directly to the drop.`,
      },
      {
        title: '4 · What the dead time costs',
        at: (r) => r.params.toff - 0.05 * (r.params.toff - r.params.ton),
        window: (r) => [0, r.params.tend],
        channels: ['phs', 'ehs', 'iF'],
        look: 'The high side’s power steps up in each dead time.',
        body: (_st, m) => `Reverse conduction costs ${formatSI(m.erevOn, 'J')} before the turn-on and ${formatSI(m.erevOff, 'J')} after the turn-off: ${formatSI(m.edead, 'J')} per cycle, ${formatSI(m.edead * 1e5, 'W')} at 100 kHz (SIMULATION). The turn-on side is longer: the dead time plus the turn-on delay.`,
      },
    ],
  },
  {
    id: 'turnon',
    title: 'Hard turn-on: no reverse recovery',
    summary: 'The low side takes the current from a high side that has no stored charge — only capacitance.',
    check: {
      question: 'When the low side takes over the load current, the GaN high side…',
      options: ['drives a reverse-recovery current spike into the low side', 'simply stops conducting; only its output capacitance must be charged', 'keeps conducting until its gate turns on'],
      answer: 1,
      explain: 'A HEMT stores no minority carriers, so its current just falls to zero (Qrr = 0). What the low side must still supply is the charge of the high side’s output capacitance — that, and the voltage–current overlap, make up Eon.',
    },
    base: {},
    steps: [
      {
        title: '1 · Turn-on delay',
        at: (r) => r.params.ton + 0.5 * (G(r).tdOn ?? 0),
        window: onWin,
        channels: ['vg', 'vgs', 'vds', 'iF'],
        look: 'The low-side gate charges; the high side is still conducting in reverse.',
        body: (st, m) => `vGS = ${formatV(st.vgs)} rises towards +6 V. Until it reaches Vth (after ${formatTime(m.tdOn ?? NaN)}) the high side keeps conducting ${formatA(st.iF)} in reverse.`,
      },
      {
        title: '2 · The current moves over — without a spike',
        at: (r) => r.params.ton + (G(r).tdOn ?? 0) + 0.6 * (G(r).tri ?? 0),
        window: onWin,
        channels: ['id', 'iF', 'vds'],
        look: 'iD rises, iHS falls to zero and stays there: no negative recovery current.',
        body: (st, m) => `iD = ${formatA(st.id, true)}, high side ${formatA(st.iF)}. The transfer takes ${formatTime(m.tri ?? NaN)}; the lowest high-side current is ${formatA(m.iFmin, true)} (SIMULATION): no reverse recovery.`,
      },
      {
        title: '3 · The voltage falls — charging the high side’s Coss',
        at: (r) => r.params.ton + (G(r).tdOn ?? 0) + (G(r).tri ?? 0) + 0.5 * (G(r).tfv ?? 0),
        window: onWin,
        channels: ['vgs', 'vds', 'id'],
        look: 'iD overshoots I0 while vDS collapses in a few nanoseconds.',
        body: (st, m) => `vDS = ${formatV(st.vds)} falling at ${((Math.abs(m.dvdtOn ?? 0)) / 1e9).toFixed(0)} V/ns. iD = ${formatA(st.id, true)} is more than I0: the extra charges the high side's output capacitance — ${formatSI(m.qoss, 'C')} in total (SIMULATION).`,
      },
      {
        title: '4 · The turn-on energy',
        at: (r) => r.params.ton + 0.4 * (r.params.toff - r.params.ton),
        window: onWin,
        channels: ['vds', 'id', 'pls', 'els'],
        look: 'One short power pulse.',
        body: (_st, m) => `Eon = ${formatSI(m.eon, 'J')} (SIMULATION), in ${formatTime((m.tri ?? 0) + (m.tfv ?? 0))}. A silicon diode here would add its reverse-recovery charge on top.`,
      },
    ],
  },
]

export const GAN_EXPERIMENTS: Array<Experiment<GanParams, GanMeasurements>> = [
  {
    id: 'voff',
    title: 'Use a −3 V gate-off voltage',
    change: () => ({ voff: -3 }),
    question: () => 'Both gates switch off to −3 V instead of 0 V (more noise margin). What happens to the dead-time loss?',
    choices: ['It rises: the reverse drop grows by 3 V', 'It falls', 'It stays the same'],
    judge: (b, a) => (a.edead > 1.15 * b.edead ? 0 : a.edead < 0.87 * b.edead ? 1 : 2),
    rows: ['vsdRev', 'erevOn', 'erevOff', 'edead'],
    why: (b, a) => `vSD ${formatV(b.vsdRev, false)} → ${formatV(a.vsdRev, false)}: the reverse channel needs vGD > Vth, so the off-voltage adds to the drop. Dead-time loss ${formatSI(b.edead, 'J')} → ${formatSI(a.edead, 'J')} per cycle.`,
  },
  {
    id: 'deadtime',
    title: 'Triple the dead time',
    change: (p) => ({ tdead: p.tdead * 3 }),
    question: (p) => `The dead time goes from ${formatTime(p.tdead)} to ${formatTime(p.tdead * 3)}. The dead-time conduction loss…`,
    choices: ['grows roughly in proportion', 'stays the same', 'falls'],
    judge: (b, a) => (a.edead > 1.5 * b.edead ? 0 : a.edead < 0.9 * b.edead ? 2 : 1),
    rows: ['trevOn', 'trevOff', 'edead', 'eon'],
    why: (b, a) => `Reverse conduction ${formatTime((b.trevOn ?? 0) + (b.trevOff ?? 0))} → ${formatTime((a.trevOn ?? 0) + (a.trevOff ?? 0))} per cycle, loss ${formatSI(b.edead, 'J')} → ${formatSI(a.edead, 'J')}. Not exactly ×3: the turn-on side always adds td(on), the turn-off side loses the voltage-rise time. The switching itself (Eon) is unchanged.`,
  },
  {
    id: 'short',
    title: 'Cut the dead time to 2 ns',
    change: () => ({ tdead: 2e-9 }),
    question: () => 'The dead time drops to 2 ns. What happens at the low side’s turn-off?',
    choices: ['Only less dead-time loss', 'Shoot-through: the high side turns on before the low side is off', 'The low side cannot turn on any more'],
    judge: (_b, a) => (a.shootThrough > 0 ? 1 : a.tdOn === null ? 2 : 0),
    rows: ['edead', 'eoff', 'shootThrough'],
    why: (b, a) => (a.shootThrough > 0 ? `The low side needs about ${formatTime((b.tdOff ?? 0) + (b.trv ?? 0))} to turn off and let the node rise; with 2 ns the high side turns on while vDS is still low: up to ${formatA(a.shootThrough)} flow straight from Vdc (limited here only by Ron — in reality by the loop inductance). Eoff ${formatSI(b.eoff, 'J')} → ${formatSI(a.eoff, 'J')}.` : `No shoot-through: the low side turned off within 2 ns. Dead-time loss ${formatSI(b.edead, 'J')} → ${formatSI(a.edead, 'J')}.`),
  },
]

export function ganPredictions(seed: number): Array<PredictTask<GanParams, GanMeasurements>> {
  const voff = [0, -2, -3][seed % 3]
  const i0 = [10, 15, 30][(seed + 1) % 3]
  const tdead = [10e-9, 20e-9, 40e-9][(seed + 2) % 3]
  return [
    {
      id: 'vsd',
      prompt: `Vth = 1.7 V, Ron = 50 mΩ, I0 = 15 A, the high-side gate held at ${voff} V. Predict its source–drain drop in the dead time.`,
      params: { voff },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vsdRev,
      tolerance: 0.03,
      hint: 'The reverse channel opens when the gate is Vth above the drain.',
      theory: (p) => `vSD = Vth − Voff + Ron·I0 = ${formatV(p.vth - p.voff + p.ron * p.i0, false)}`,
    },
    {
      id: 'sync',
      prompt: `Ron = 50 mΩ, I0 = ${i0} A. Predict the high side’s drop while its gate is ON.`,
      params: { i0 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vsdSync,
      tolerance: 0.03,
      hint: 'With the gate on, the channel is just a resistor — in both directions.',
      theory: (p) => `vSD = Ron·I0 = ${formatV(p.ron * p.i0, false)}`,
    },
    {
      id: 'erev',
      prompt: `vSD ≈ 2.45 V in the dead time, I0 = 15 A, dead time ${formatTime(tdead)}. Predict the reverse-conduction energy before the turn-on (in nJ).`,
      params: { tdead },
      kind: 'number',
      unit: 'nJ',
      answer: (m) => m.erevOn * 1e9,
      tolerance: 0.1,
      hint: 'Drop × current × time — and the reverse conduction lasts a little longer than the dead time.',
      theory: (p) => `E ≈ (Vth − Voff + Ron·I0)·I0·t_dead = ${formatSI((p.vth - p.voff + p.ron * p.i0) * p.i0 * p.tdead, 'J')} (plus the turn-on delay)`,
    },
    {
      id: 'qrr',
      prompt: 'When the low side turns on, does the GaN high side show a reverse-recovery current spike?',
      params: {},
      kind: 'choice',
      choices: ['Yes, like a silicon diode', 'No: its current falls to zero and stays there'],
      answer: (m) => (m.iFmin < -1e-3 ? 0 : 1),
      hint: 'Reverse recovery needs stored minority carriers.',
      theory: () => 'A HEMT conducts by a two-dimensional electron gas only: no minority carriers, Qrr = 0. The low side still charges the high side’s Coss.',
    },
  ]
}
