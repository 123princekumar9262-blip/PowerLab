import type { CurrentPath, EnergyModel, NextConsequence, StatusInfo } from '../../workspace/contract.ts'
import { nextRunEvent } from '../cursor.ts'
import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { reading } from '../../lab/readings.ts'
import { formatA, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { BAT_DEFAULTS, behindR0, cellCurrent, cellVoltage, ocv, resolveBattery, simulateBattery, type BatteryParams, type BatteryRun, type ResolvedBattery } from './battery.ts'
import { ccDischargeClosedForm, exactBattery, ocvIntegral, piecewiseClosedForm, usableTextbook, type BatteryExact } from './batteryTheory.ts'

export { BAT_DEFAULTS, simulateBattery }

/** A duration in words: "1 h 05 min", "12 min 30 s", "45.0 s". */
export function fmtDur(s: number): string {
  if (!Number.isFinite(s)) return '—'
  const a = Math.abs(s)
  if (a < 60) return `${a.toFixed(1)} s`
  if (a < 3600) return `${Math.floor(a / 60)} min ${String(Math.round(a % 60)).padStart(2, '0')} s`
  const h = Math.floor(a / 3600)
  return `${h} h ${String(Math.round((a - 3600 * h) / 60)).padStart(2, '0')} min`
}
const ah = (x: number) => `${x.toFixed(3)} Ah`
const wh = (x: number) => `${x.toFixed(2)} Wh`
const pc = (x: number, d = 1) => `${x.toFixed(d)} %`
const cellList = (xs: number[]) => (xs.length === 0 ? 'none' : xs.length === 1 ? `cell ${xs[0]}` : `cells ${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

// ── MEASUREMENTS ──────────────────────────────────────────────────────────────────────────────────────

export interface BatteryMeasurements {
  /** Discharge (or pulse train): charge [Ah], energy [Wh] at the pack terminals, its duration [s]. */
  qDis: number | null
  eDis: number | null
  tDis: number | null
  /** The cut-off: when, which cell (1-based), the mean SOC of all cells then [%]. */
  tCut: number | null
  cutCell: number | null
  socAtCut: number | null
  /** Charge: charge [Ah] and energy [Wh] into the pack, CC → CV instant after the charge start [s], duration [s]. */
  qCh: number | null
  eCh: number | null
  tCv: number | null
  tCharge: number | null
  /** Spread of the cells' SOC (max − min) [%-points] at the start, at the end of the charge, at the end. */
  spread0: number
  spreadCh: number | null
  spreadEnd: number
  /** Pack voltage at rest just before the load, its instant drop, its drop after T s of load [V]. */
  vRest: number | null
  vSag0: number | null
  vSagT: number | null
  sagT: number
  /** Pulses: drop left at the end of the first rest; discharge: rebound after the cut-off [V]. */
  vRec: number | null
  rebound: number | null
  /** SOC at the end [%]: every cell, min, max, mean; the BMS estimate and its error [%-points]. */
  socEnd: number[]
  socMinEnd: number
  socMaxEnd: number
  socAvgEnd: number
  socEstEnd: number
  socEstErr: number
  /** Energy burnt in the bleed resistors [Wh]. */
  eBleed: number
  vCellMin: number
  vCellMax: number
  iPeak: number
  duration: number
}

const idx = (r: BatteryRun, t: number) => Math.min(r.length - 1, Math.max(0, Math.round(t / r.params.dt)))
const spreadAt = (r: BatteryRun, k: number) => r.signals.socmax[k] - r.signals.socmin[k]
const firstEv = (r: BatteryRun, d: string) => r.events.find((e) => e.device === d) ?? null

export function measureBattery(r: BatteryRun): BatteryMeasurements {
  const p = r.params
  const s = r.signals
  const n = r.length
  const phaseKind = (i: number) => p.phases[i].kind
  const dis = r.phaseSpan.find((sp) => phaseKind(sp.index) === 'dis' || phaseKind(sp.index) === 'pulse') ?? null
  const ch = r.phaseSpan.find((sp) => phaseKind(sp.index) === 'charge') ?? null
  const cut = firstEv(r, 'cutoff')
  const cvEv = r.events.find((e) => e.device === 'cv' && ch && e.time >= ch.t0 - 1e-9) ?? null
  const load = firstEv(r, 'load-on')
  let vRest: number | null = null
  let vSag0: number | null = null
  let vSagT: number | null = null
  let vRec: number | null = null
  let rebound: number | null = null
  const sagT = p.profile === 'pulse' ? p.pulseOn : 60
  if (load) {
    const kL = idx(r, load.time)
    vRest = s.vpack[kL]
    vSag0 = vRest - load.values.vpack
    if (!cut || cut.time >= load.time + sagT) vSagT = vRest - s.vpack[idx(r, load.time + sagT)]
    if (p.profile === 'pulse') {
      const kE = idx(r, load.time + p.pulseOn + p.pulseOff)
      if (!cut || cut.time > r.time[kE]) vRec = vRest - s.vpack[kE]
    }
  }
  if (cut) rebound = s.vpack[n - 1] - cut.values.vpack
  let iPeak = 0
  let vCellMin = Infinity
  let vCellMax = -Infinity
  for (let k = 0; k < n; k++) {
    iPeak = Math.max(iPeak, Math.abs(s.ipack[k]))
    vCellMin = Math.min(vCellMin, s.vmin[k])
    vCellMax = Math.max(vCellMax, s.vmax[k])
  }
  const socEnd = Array.from({ length: p.n }, (_, i) => s[`s${i + 1}`][n - 1])
  const qDis = dis ? (dis.q1 - dis.q0) / 3600 : null
  const eDis = dis ? (dis.e1 - dis.e0) / 3600 : null
  const eCh = ch ? -(ch.e1 - ch.e0) / 3600 : null
  return {
    qDis,
    eDis,
    tDis: dis ? dis.t1 - dis.t0 : null,
    tCut: cut ? cut.time : null,
    cutCell: cut ? (cut.values.cell ?? null) : null,
    socAtCut: cut ? cut.values.socavg : null,
    qCh: ch ? -(ch.q1 - ch.q0) / 3600 : null,
    eCh,
    tCv: cvEv && ch ? cvEv.time - ch.t0 : null,
    tCharge: ch ? ch.t1 - ch.t0 : null,
    spread0: spreadAt(r, 0),
    spreadCh: ch ? spreadAt(r, idx(r, ch.t1)) : null,
    spreadEnd: spreadAt(r, n - 1),
    vRest,
    vSag0,
    vSagT,
    sagT,
    vRec,
    rebound,
    socEnd,
    socMinEnd: s.socmin[n - 1],
    socMaxEnd: s.socmax[n - 1],
    socAvgEnd: s.socavg[n - 1],
    socEstEnd: s.soce[n - 1],
    socEstErr: s.soce[n - 1] - s.socavg[n - 1],
    eBleed: r.phaseSpan.reduce((a, sp) => a + (sp.eb1 - sp.eb0), 0) / 3600,
    vCellMin,
    vCellMax,
    iPeak,
    duration: r.params.duration,
  }
}

// ── STATE AT THE CURSOR ───────────────────────────────────────────────────────────────────────────────

export interface CellState {
  i: number
  v: number
  s: number
  ocv: number
  u: number
  w: number
  bleed: boolean
  i_cell: number
}
export interface BatteryState {
  k: number
  t: number
  I: number
  vpack: number
  vocv: number
  vr0: number
  vpol: number
  soce: number
  socavg: number
  cells: CellState[]
  /** Lowest and highest cell (0-based) by voltage now. */
  lo: number
  hi: number
  /** 0 rest, 1 load, 2 CC charge, 3 CV charge. */
  mode: number
  phase: string
  phaseKind: 'rest' | 'dis' | 'pulse' | 'charge'
  /** Has the discharge already been cut off at this instant? */
  cutOff: boolean
  label: 'at rest' | 'discharging' | 'pulse' | 'between pulses' | 'charging · CC' | 'charging · CV' | 'cut off · resting' | 'balancing at rest'
  bleeding: number[]
  /** Energy left in the cells down to 0 % SOC [J]. */
  eLeft: number
}

export function batteryStateAt(r: BatteryRun, k: number): BatteryState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const I = s.ipack[i]
  const cells: CellState[] = []
  let eLeft = 0
  for (let c = 0; c < p.n; c++) {
    const soc = s[`s${c + 1}`][i] / 100
    const u = s[`u${c + 1}`][i]
    const w = s[`w${c + 1}`][i]
    const bl = s[`b${c + 1}`][i] > 0.5
    const e = behindR0(soc, u, w)
    cells.push({ i: c, v: s[`v${c + 1}`][i], s: 100 * soc, ocv: ocv(soc), u, w, bleed: bl, i_cell: cellCurrent(p, e, I, bl ? 1 : 0) })
    eLeft += p.q[c] * ocvIntegral(0, Math.max(0, soc))
  }
  let lo = 0
  let hi = 0
  cells.forEach((c, j) => {
    if (c.v < cells[lo].v) lo = j
    if (c.v > cells[hi].v) hi = j
  })
  const ph = p.phases[r.phaseAt[i]]
  const mode = s.mode[i]
  const t = r.time[i]
  const cut = r.events.find((e) => e.device === 'cutoff')
  const cutOff = !!cut && t >= cut.time
  const bleeding = cells.filter((c) => c.bleed).map((c) => c.i + 1)
  const label: BatteryState['label'] =
    mode === 1
      ? ph.kind === 'pulse'
        ? 'pulse'
        : 'discharging'
      : mode === 2
        ? 'charging · CC'
        : mode === 3
          ? 'charging · CV'
          : ph.kind === 'pulse'
            ? 'between pulses'
            : cutOff && ph.kind === 'rest'
              ? 'cut off · resting'
              : bleeding.length
                ? 'balancing at rest'
                : 'at rest'
  return { k: i, t, I, vpack: s.vpack[i], vocv: s.vocv[i], vr0: s.vr0[i], vpol: s.vpol[i], soce: s.soce[i], socavg: s.socavg[i], cells, lo, hi, mode, phase: ph.name, phaseKind: ph.kind, cutOff, label, bleeding, eLeft }
}

export function batteryView(st: BatteryState, r: BatteryRun): StateView {
  const p = r.params
  const lo = st.cells[st.lo]
  const hi = st.cells[st.hi]
  return {
    badge: { text: st.label, tone: st.mode === 1 ? 'on' : st.mode >= 2 ? 'on' : st.cutOff ? 'off' : 'idle' },
    rows: [
      { k: 't', v: fmtDur(st.t), full: true },
      { k: 'pack current', v: formatA(st.I, true), tone: st.I > 0 ? 'on-q' : st.I < 0 ? 'on-d' : 'off' },
      { k: 'pack voltage', v: formatV(st.vpack, false) },
      { k: 'lowest cell', v: `${formatV(lo.v, false)} (cell ${lo.i + 1})`, tone: lo.v <= p.vmin + 0.05 && st.I > 0 ? 'bad' : undefined },
      { k: 'highest cell', v: `${formatV(hi.v, false)} (cell ${hi.i + 1})` },
      { k: 'SOC, BMS estimate', v: pc(st.soce) },
      { k: 'SOC, true mean of the cells', v: pc(st.socavg), min: 'standard' },
      { k: 'bleeding', v: cellList(st.bleeding), min: 'standard', full: true },
      { k: 'sum of the OCVs', v: formatV(st.vocv, false), min: 'standard' },
      { k: 'R0 drop (all cells)', v: formatV(st.vr0, true), min: 'engineer' },
      { k: 'RC polarisation (all cells)', v: formatV(st.vpol, true), min: 'engineer' },
      { k: 'phase', v: st.phase, min: 'engineer' },
    ],
    path: pathText(st),
  }
}

function pathText(st: BatteryState): string {
  const bl = st.bleeding.length ? ` · bleeding: ${cellList(st.bleeding)} → their resistors` : ''
  if (st.I > 1e-9) return `cells 1…${st.cells.length} (in series) → contactor → load (${formatA(st.I)})${bl}`
  if (st.I < -1e-9) return `charger → contactor → cells 1…${st.cells.length} (in series) (${formatA(-st.I)})${bl}`
  return `no pack current (contactor ${st.cutOff ? 'open after the cut-off' : 'idle'})${bl}`
}
export function batteryPath(st: BatteryState): CurrentPath {
  const els = st.I !== 0 ? ['pack', 'load'] : []
  for (const c of st.bleeding) els.push(`cell${c}`)
  const reasons: string[] = []
  if (st.I > 0) reasons.push('The load draws the pack current through every cell in turn: a series string carries one current.')
  if (st.I < 0) reasons.push('The charger pushes current into the string; every cell receives the same current.')
  if (st.bleeding.length) reasons.push(`The BMS closed the bleed switch of ${cellList(st.bleeding)}: that cell also feeds its own resistor, so it charges more slowly (or discharges) than the others.`)
  return { elements: els, text: pathText(st), reasons }
}

export function batteryStatus(st: BatteryState, r: BatteryRun): StatusInfo {
  const p = r.params
  const lo = st.cells[st.lo]
  const hi = st.cells[st.hi]
  const head =
    st.mode === 1
      ? `${st.phaseKind === 'pulse' ? 'Pulse' : 'Discharging'} at ${formatA(st.I)} · lowest cell ${formatV(lo.v, false)} (cell ${lo.i + 1})`
      : st.mode === 2
        ? `Charging at constant current ${formatA(-st.I)} · highest cell ${formatV(hi.v, false)}`
        : st.mode === 3
          ? `Charging at constant voltage: cell ${hi.i + 1} held at ${formatV(p.vmax, false)} · ${formatA(-st.I)}`
          : st.cutOff && st.phaseKind === 'rest'
            ? `Cut off: cell ${(r.events.find((e) => e.device === 'cutoff')?.values.cell ?? lo.i + 1).toFixed(0)} reached ${formatV(p.vmin, false)} · resting`
            : `At rest · pack ${formatV(st.vpack, false)}`
  const facts = [`pack ${formatV(st.vpack, false)}`, `SOC ${pc(st.soce)} (BMS)`]
  if (st.bleeding.length) facts.push(`bleeding: ${cellList(st.bleeding)}`)
  return { headline: head, facts, tone: st.mode === 0 ? (st.cutOff ? 'off' : 'idle') : 'on' }
}

// ── WHY ───────────────────────────────────────────────────────────────────────────────────────────────

export function batteryWhy(r: BatteryRun, st: BatteryState, m: BatteryMeasurements): WhyCard[] {
  const p = r.params
  const lo = st.cells[st.lo]
  const hi = st.cells[st.hi]
  const cards: WhyCard[] = []
  if (st.mode === 1)
    cards.push({
      id: 'now',
      question: `What is happening now? (${st.label})`,
      what: `The pack delivers ${formatA(st.I)}. Every cell carries this same current. Cell ${lo.i + 1} has the lowest voltage, ${formatV(lo.v, false)}.`,
      why: `Each cell's terminal voltage is its OCV minus two drops. One is the R0·I drop, which appears instantly. The other is the RC polarisation, which builds up over seconds to minutes. Cell ${lo.i + 1} is lowest: its own OCV is lowest, because it holds the least charge.`,
      equation: 'V = OCV(SOC) − R0·I − u − w',
      physics: `Now: OCV ${formatV(lo.ocv, false)} − R0·I ${formatV(p.r0 * st.I, false)} − RC ${formatV(lo.u + lo.w, false)} = ${formatV(lo.v, false)}.`,
      whatIf: `When the lowest cell reaches ${formatV(p.vmin, false)}, the BMS opens the contactor, even though the other cells still hold charge.`,
    })
  else if (st.mode >= 2)
    cards.push({
      id: 'now',
      question: `What is happening now? (${st.label})`,
      what:
        st.mode === 2
          ? `The charger pushes a constant ${formatA(-st.I)} into the string. Cell ${hi.i + 1} is the highest, at ${formatV(hi.v, false)}.`
          : `Cell ${hi.i + 1} has reached ${formatV(p.vmax, false)}. The BMS lowers the current (now ${formatA(-st.I)}) so that no cell goes above Vmax.`,
      why:
        st.mode === 2
          ? 'Every cell receives the same current, so the cell with the most charge (or the least capacity) reaches the top first.'
          : 'Constant-voltage phase: as the cell fills, its OCV approaches Vmax, so less current is needed to hold it there. The current tapers.',
      equation: st.mode === 2 ? 'I = −chargeRate·Qnom' : 'V_held = OCV − u − w − R0·i = Vmax',
      physics: `Charge accepted so far: ${ah(Math.abs(r.signals.qpack[st.k] - (r.phaseSpan.find((s) => p.phases[s.index].kind === 'charge')?.q0 ?? 0) / 3600))}.`,
      whatIf: `The charge ends when the current falls below C/20 = ${formatA(p.iTerm)} and no cell is bleeding.`,
    })
  else
    cards.push({
      id: 'now',
      question: `What is happening now? (${st.label})`,
      what: `No pack current. The terminal voltage is ${formatV(st.vpack, false)}; the sum of the OCVs is ${formatV(st.vocv, false)}.`,
      why: 'At rest the R0 drop is gone at once. The RC pairs still hold a voltage, which decays with their time constants. That is why a battery "recovers" after a load.',
      equation: 'u(t) = u0·e^(−t/τ1),  w(t) = w0·e^(−t/τ2)',
      physics: `Polarisation left now: ${formatV(st.vpol, true)} over the pack (τ1 = ${p.tau1} s, τ2 = ${p.tau2} s).`,
      whatIf: st.cutOff ? 'The voltage climbs back above the cut-off. That does not mean the weakest cell has charge to spare: under load it would drop again at once.' : 'A load would pull the voltage down by R0·I at once, then by the RC drops.',
    })
  if (st.bleeding.length || (st.phaseKind === 'charge' && p.balancing === 'on'))
    cards.push({
      id: 'balance',
      question: 'Why are some bleed resistors on?',
      what: st.bleeding.length ? `${cellList(st.bleeding)} ${st.bleeding.length === 1 ? 'is' : 'are'} more than ${(p.threshold * 1000).toFixed(0)} mV above the lowest cell, so the BMS switched on their bleed resistors.` : `No cell is more than ${(p.threshold * 1000).toFixed(0)} mV above the lowest right now.`,
      why: 'Passive balancing burns charge from the highest cells as heat. While charging, this slows the high cells, so the charger can keep going until the low cells are full too.',
      equation: 'I_bleed = V / Rbal',
      physics: `Rbal = ${p.rbal} Ω → ${formatA(st.vpack / st.cells.length / p.rbal)} per bleeding cell at the present cell voltage. Energy burnt in the bleed resistors over the run: ${wh(m.eBleed)}.`,
      whatIf: 'With balancing off, the mismatch stays. The weakest cell then limits both the charge and the discharge.',
    })
  if (m.tCut !== null)
    cards.push({
      id: 'weakest',
      question: 'Why does one cell end the whole discharge?',
      what: `At ${fmtDur(m.tCut)} cell ${m.cutCell} reached ${formatV(p.vmin, false)}. The mean SOC of the cells was still ${pc(m.socAtCut ?? NaN)}.`,
      why: 'The cells are in series, so they all carry the same current. The first cell to reach its cut-off voltage stops all of them. The charge left in the other cells cannot be used.',
      equation: 'Q_usable = min over cells of (charge above cut-off)',
      physics: `Delivered: ${ah(m.qDis ?? NaN)}, ${wh(m.eDis ?? NaN)} (SIMULATION).`,
      whatIf: 'Balancing during the charge brings the cells closer, so more of the pack becomes usable.',
    })
  cards.push({
    id: 'soc',
    question: 'How does the BMS know the state of charge?',
    what: `By counting charge: ${pc(st.soce)} now. The true mean SOC of the cells is ${pc(st.socavg)}.`,
    why: 'The BMS integrates the measured current over time (coulomb counting). The bleed currents do not pass the current sensor. Any sensor offset adds up over time.',
    equation: 'SOC_est = SOC_est(0) − ∫(I + I_offset) dt / Q_nom',
    physics: `Sensor offset ${formatA(p.iOffset, true)}. Error at the end of the run: ${m.socEstErr >= 0 ? '+' : ''}${m.socEstErr.toFixed(2)} %-points.`,
    whatIf: 'Real BMSs correct the count with the OCV whenever the pack rests: at rest the terminal voltage approaches the OCV, which gives the SOC.',
  })
  return cards
}

// ── EVENTS ────────────────────────────────────────────────────────────────────────────────────────────

const EV_LABEL: Record<string, string> = {
  'load-on': 'Load on',
  'pulse-on': 'Pulse on',
  'pulse-off': 'Pulse off',
  'pulses-done': 'Pulse train over',
  cutoff: 'Cut-off: a cell reached Vmin',
  'charge-on': 'Charger on (CC)',
  cv: 'CC → CV: a cell reached Vmax',
  'cv-cell': 'CV: another cell is now the highest',
  cc: 'Back to constant current',
  'charge-end': 'Charge complete',
  timer: 'Safety timer',
  'bleed-on': 'Bleed resistor on',
  'bleed-off': 'Bleed resistor off',
}
export function batteryEventLabel(e: RunEvent): string {
  const base = EV_LABEL[e.device ?? ''] ?? e.device ?? e.kind
  return e.values.cell !== undefined && /bleed|cutoff|cv/.test(e.device ?? '') ? `${base} (cell ${e.values.cell})` : base
}
export function batteryEventWhy(e: RunEvent): string {
  const v = `Pack ${formatV(e.values.vpack ?? NaN, false)}, ${formatA(e.values.ipack ?? NaN, true)}.`
  switch (e.device) {
    case 'load-on':
      return `${v} The voltage drops at once by R0·I in every cell, then sinks further as the RC pairs charge.`
    case 'pulse-off':
      return `${v} The R0 drop disappears at once; the RC part recovers slowly.`
    case 'cutoff':
      return `${v} Cell ${e.values.cell} reached the cut-off voltage. The BMS opens the contactor, and the discharge ends for the whole pack.`
    case 'cv':
      return `${v} Cell ${e.values.cell} reached Vmax. From here the current falls so that it stays at Vmax.`
    case 'charge-end':
      return `${v} The current fell below C/20 and no cell is bleeding: the charge is complete.`
    case 'bleed-on':
      return `Cell ${e.values.cell} is more than the threshold above the lowest cell: its bleed resistor is switched on.`
    case 'bleed-off':
      return `Cell ${e.values.cell} is back within half the threshold of the lowest cell: bleeding stops.`
    default:
      return v
  }
}

export function batteryNext(r: BatteryRun, st: BatteryState): NextConsequence | null {
  // the next event that matters (bleed switching is frequent: only phase-level events are quoted)
  const e = nextRunEvent(r, st.k)
  let ev = e
  if (ev && /bleed/.test(ev.device ?? '')) ev = r.events.find((x) => x.time > st.t + 1e-9 && !/bleed|pulse-/.test(x.device ?? '')) ?? e
  if (!ev) return null
  return { text: `${batteryEventLabel(ev)} at ${fmtDur(ev.time)}. ${batteryEventWhy(ev)}`, time: ev.time }
}

// ── ENERGY AT THE CURSOR ──────────────────────────────────────────────────────────────────────────────

export function batteryEnergy(st: BatteryState, r: BatteryRun): EnergyModel {
  const p = r.params
  let chem = 0
  let r0 = 0
  let rcR = 0
  let rcC = 0
  let bleed = 0
  let eC = 0
  for (const c of st.cells) {
    const ic = c.i_cell
    chem += c.ocv * ic
    r0 += p.r0 * ic * ic
    const ir1 = p.r1 > 0 ? c.u / p.r1 : 0
    const ir2 = p.r2 > 0 ? c.w / p.r2 : 0
    rcR += c.u * ir1 + c.w * ir2
    rcC += c.u * (ic - ir1) + c.w * (ic - ir2)
    bleed += c.v * (ic - st.I)
    eC += 0.5 * (p.tau1 / Math.max(p.r1, 1e-12)) * c.u * c.u * (p.r1 > 0 ? 1 : 0) + 0.5 * (p.tau2 / Math.max(p.r2, 1e-12)) * c.w * c.w * (p.r2 > 0 ? 1 : 0)
  }
  const term = st.vpack * st.I
  const full = p.q.reduce((a, q) => a + q * ocvIntegral(0, 1), 0)
  const ledger = [
    { id: 'cells', label: 'Cell chemistry (OCV·i)', watts: -chem, note: chem >= 0 ? 'supplying' : 'being charged' },
    { id: 'r0', label: 'R0 losses', watts: r0, note: 'heat, R0·i²' },
    { id: 'rc', label: 'RC resistors', watts: rcR, note: 'heat, u²/R1 + w²/R2' },
    { id: 'rcC', label: 'RC capacitors', watts: rcC, note: rcC >= 0 ? 'storing' : 'releasing' },
    { id: 'bleed', label: 'Bleed resistors', watts: bleed, note: 'balancing heat' },
    { id: 'load', label: st.I >= 0 ? 'Load' : 'Charger', watts: term, note: st.I > 0 ? 'absorbing' : st.I < 0 ? 'supplying' : 'none' },
  ]
  const balance = ledger.reduce((a, l) => a + l.watts, 0)
  return {
    ledger,
    stores: [
      { id: 'cells', label: 'Energy left in the cells', joules: st.eLeft, fraction: st.eLeft / full, detail: `${wh(st.eLeft / 3600)} to 0 % SOC` },
      { id: 'rc', label: 'RC capacitors', joules: eC, fraction: Math.min(1, eC / Math.max(1e-9, 0.5 * (p.tau1 * p.r1 + p.tau2 * p.r2) * p.n * p.iNom * p.iNom * 4)), detail: 'polarisation energy' },
    ],
    balance,
    tolerance: 1e-6 * Math.max(1, Math.abs(chem)),
    summary: `${formatW(Math.abs(term))} ${st.I > 0 ? 'to the load' : st.I < 0 ? 'from the charger' : ''}, ${formatW(r0 + rcR + bleed)} turned into heat inside the pack.`,
  }
}

// ── SIMULATION vs THEORY ──────────────────────────────────────────────────────────────────────────────

const exactCache = new WeakMap<BatteryRun, BatteryExact>()
export function exactFor(r: BatteryRun): BatteryExact {
  let e = exactCache.get(r)
  if (!e) {
    e = exactBattery(r.params)
    exactCache.set(r, e)
  }
  return e
}
/** Pack voltage of the exact solution at tick k. */
function exactVpack(p: ResolvedBattery, ex: BatteryExact, k: number, I = ex.I[k]): number {
  const x = ex.x[Math.min(k, ex.x.length - 1)]
  const b = ex.beta[Math.min(k, ex.beta.length - 1)]
  let v = 0
  for (let i = 0; i < p.n; i++) v += cellVoltage(p, behindR0(x[3 * i], x[3 * i + 1], x[3 * i + 2]), I, b[i])
  return v
}

export function compareBattery(r: BatteryRun, m: BatteryMeasurements): CompareResult {
  const p = r.params
  const ex = exactFor(r)
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tol: number, tb: { v: number; f: string; a: string[] } | null = null, scale?: number) => {
    if (sim === null || exact === null || !Number.isFinite(sim) || !Number.isFinite(exact)) return
    const den = scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const textbook: TextbookValue | null = tb ? { key, value: tb.v, formula: tb.f, assumptions: tb.a } : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, absolute: false, textbook, textbookError: tb ? (sim - tb.v) / Math.max(Math.abs(tb.v), 1e-30) : null })
  }
  const exEv = (d: string) => ex.events.find((e) => e.device === d) ?? null
  const kind = (i: number) => p.phases[i].kind
  const exDis = ex.spans.find((s) => kind(s.index) === 'dis' || kind(s.index) === 'pulse') ?? null
  const exCh = ex.spans.find((s) => kind(s.index) === 'charge') ?? null
  const kEnd = ex.x.length - 1
  const exSoc = (i: number) => 100 * ex.x[kEnd][3 * i]
  const exSocs = Array.from({ length: p.n }, (_, i) => exSoc(i))
  // tolerances: RK4 with a 1-s (0.5-s) step on time constants ≥ 5 s has a local error below 10⁻⁵ of the RC
  // voltages, and every event is located to 10⁻¹² s in both solutions: 0.01 % (times, charges, energies)
  const TOL = 1e-4
  // closed-form textbook values where they are exact (no bleeding during these phases)
  const start = p.s0.map((s) => ({ s, u: 0, w: 0 }))
  const load = firstEv(r, 'load-on')
  if (m.tCharge !== null && exCh) {
    add('qCh', 'Charge accepted', 'Ah', m.qCh, -exCh.q / 3600, TOL)
    add('eCh', 'Energy into the pack', 'Wh', m.eCh, -exCh.e / 3600, TOL)
    const exCv = ex.events.find((e) => e.device === 'cv')
    if (m.tCv !== null && exCv) add('tCv', 'CC → CV after', 's', m.tCv, exCv.t - exCh.t0, TOL)
    add('tCharge', 'Charge time', 's', m.tCharge, exCh.t1 - exCh.t0, TOL)
    const kc = Math.round(exCh.t1 / p.tick)
    const xs = ex.x[Math.min(kc, kEnd)]
    const sp = (z: Float64Array) => 100 * (Math.max(...p.s0.map((_, i) => z[3 * i])) - Math.min(...p.s0.map((_, i) => z[3 * i])))
    add('spreadCh', 'SOC spread after the charge [%-points]', '', m.spreadCh, sp(xs), 1e-3, null, Math.max(1, sp(xs)))
  }
  if (exDis && m.qDis !== null) {
    let cf: ReturnType<typeof ccDischargeClosedForm> | null = null
    if (p.profile === 'discharge') cf = ccDischargeClosedForm(p, start, p.iDis)
    const tbU = (() => {
      // textbook usable charge from the state at the start of the discharge
      const k0 = Math.round(exDis.t0 / p.tick)
      const z = ex.x[Math.min(k0, kEnd)]
      return usableTextbook(p, p.s0.map((_, i) => z[3 * i]), p.iDis)
    })()
    add('qDis', p.profile === 'pulse' ? 'Charge delivered by the pulses' : 'Charge delivered (usable)', 'Ah', m.qDis, exDis.q / 3600, TOL, p.profile === 'pulse' ? null : { v: tbU.q / 3600, f: 'min over cells of Q·(SOC − SOC at Vmin + (R0+R1+R2)·I)', a: ['steady polarisation', 'the weakest cell sets the end'] })
    add('eDis', 'Energy delivered', 'Wh', m.eDis, exDis.e / 3600, TOL, cf ? { v: cf.e / 3600, f: 'I·∫Σ(OCV(s0 − I·t/Q) − R0·I − u − w)dt', a: ['closed form: RC step response, SOC by charge integration'] } : null)
    const exCut = exEv('cutoff')
    if (m.tCut !== null && exCut) add('tCut', `Cut-off (cell ${m.cutCell}${exCut.cell !== m.cutCell ? ` vs ${exCut.cell}` : ''})`, 's', m.tCut, exCut.t, TOL, cf ? { v: cf.t + exDis.t0, f: 'V_cell(t) = Vmin, closed form', a: ['RC step response'] } : null)
  }
  if (load && m.vSag0 !== null) {
    const kL = Math.round(load.time / p.tick)
    const vR = exactVpack(p, ex, kL, 0)
    add('vSag0', 'Instant drop at the load step', 'V', m.vSag0, vR - exactVpack(p, ex, kL, p.iDis), TOL, { v: p.n * p.r0 * p.iDis, f: 'N·R0·I', a: ['R0 responds instantly; the RC pairs cannot jump'] })
    if (m.vSagT !== null) {
      const k = kL + Math.round(m.sagT / p.tick)
      const cfT = piecewiseClosedForm(p, start, [{ I: p.iDis, h: m.sagT }])[1]
      // from rest (u = w = 0): the closed-form RC step response
      const tbv = p.profile !== 'cycle' ? exactVpack(p, ex, kL, 0) - cfT.reduce((a, c) => a + ocv(c.s) - c.u - c.w - p.r0 * p.iDis, 0) : null
      add('vSagT', `Drop after ${m.sagT} s of load`, 'V', m.vSagT, vR - exactVpack(p, ex, k), TOL, tbv !== null ? { v: tbv, f: 'N·R0·I + Σ R·I·(1 − e^(−t/τ)) + ΔOCV', a: ['RC step response from rest'] } : null)
    }
    if (m.vRec !== null) {
      const k = kL + Math.round((p.pulseOn + p.pulseOff) / p.tick)
      add('vRec', 'Drop left after the first rest', 'V', m.vRec, vR - exactVpack(p, ex, k), 1e-3, null, Math.max(1e-3, Math.abs(vR - exactVpack(p, ex, k))))
    }
  }
  if (m.rebound !== null) {
    const exCut = exEv('cutoff')
    if (exCut && exCut.v !== undefined) {
      const reb = exactVpack(p, ex, kEnd) - exCut.v
      add('rebound', 'Rebound after the cut-off', 'V', m.rebound, reb, 1e-3, null, Math.max(1e-3, Math.abs(reb)))
    }
  }
  add('socMinEnd', 'Lowest cell SOC at the end [%]', '', m.socMinEnd, Math.min(...exSocs), TOL, null, Math.max(1, Math.min(...exSocs)))
  add('socMaxEnd', 'Highest cell SOC at the end [%]', '', m.socMaxEnd, Math.max(...exSocs), TOL, null, Math.max(1, Math.max(...exSocs)))
  const estEx = 100 * (p.socEst0 - (ex.q + p.iOffset * ex.duration) / (3600 * p.capacity))
  add('socEstEnd', 'SOC estimate at the end, coulomb counting [%]', '', m.socEstEnd, estEx, TOL, null, 1)
  if (m.eBleed > 0) add('eBleed', 'Energy burnt in the bleed resistors', 'Wh', m.eBleed, ex.eb / 3600, TOL)
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `SIMULATION: fourth-order Runge–Kutta, ${p.tick}-s step, events located by bisection. THEORY: the exact solution of the same piecewise-linear cell model (matrix exponential between BMS samples and OCV breakpoints; events found on the exact flow).`,
    note: 'OCV from a typical NMC table; no temperature, no ageing, no hysteresis. The bleed current is larger than in most packs so that balancing acts within one charge.',
  }
}

// ── READINGS ──────────────────────────────────────────────────────────────────────────────────────────

export function batteryReadings(m: BatteryMeasurements, r: BatteryRun): Reading[] {
  const p = r.params
  const none = '—'
  if (p.profile === 'pulse')
    return [
      reading('sag0', 'Instant drop at the pulse', m.vSag0 === null ? none : formatV(m.vSag0, false), `N·R0·I, N = ${p.n}`),
      reading('sagT', `Drop at the end of the pulse`, m.vSagT === null ? none : formatV(m.vSagT, false), 'R0 plus the RC pairs charging'),
      reading('rec', 'Drop left after the rest', m.vRec === null ? none : formatV(m.vRec, false), 'the RC pairs relax slowly'),
      reading('e', 'Energy delivered', m.eDis === null ? none : wh(m.eDis), '∫V·I dt', 'standard'),
    ]
  if (p.profile === 'charge')
    return [
      reading('q', 'Charge accepted', m.qCh === null ? none : ah(m.qCh), '∫I dt'),
      reading('t', 'Charge time', m.tCharge === null ? none : fmtDur(m.tCharge), 'CC, then CV until I < C/20'),
      reading('spread', 'SOC spread after the charge', m.spreadCh === null ? none : `${m.spreadCh.toFixed(2)} %`, `highest − lowest cell; at the start ${m.spread0.toFixed(1)} %`),
      reading('bleed', 'Burnt in the bleed resistors', wh(m.eBleed), 'passive balancing'),
    ]
  const rows = [
    reading('q', 'Usable charge (discharge)', m.qDis === null ? none : ah(m.qDis), 'until the first cell reaches Vmin'),
    { id: 'weak', label: 'Cell that ends the discharge', value: m.cutCell === null ? 'none' : `cell ${m.cutCell}`, unit: '', note: m.socAtCut === null ? 'no cut-off in this run' : `mean SOC then ${pc(m.socAtCut)}` },
    reading('e', 'Energy delivered', m.eDis === null ? none : wh(m.eDis), '∫V·I dt at the pack terminals'),
  ]
  if (p.profile === 'cycle') rows.push(reading('spread', 'SOC spread after the charge', m.spreadCh === null ? none : `${m.spreadCh.toFixed(2)} %`, `highest − lowest; at the start ${m.spread0.toFixed(1)} %`, 'standard'))
  else rows.push(reading('sag', 'Instant drop at the load step', m.vSag0 === null ? none : formatV(m.vSag0, false), 'N·R0·I', 'standard'))
  return rows
}

// ── LESSONS, EXPERIMENTS, PREDICTIONS ─────────────────────────────────────────────────────────────────

type L = Lesson<BatteryParams, BatteryRun, BatteryMeasurements, BatteryState>
const evT = (r: BatteryRun, d: string, n = 0) => r.events.filter((e) => e.device === d)[n]?.time ?? NaN
const span = (r: BatteryRun, a: number, b: number): [number, number] => [Math.max(0, a), Math.min(r.params.duration, b)]

export const BATTERY_LESSONS: L[] = [
  {
    id: 'sag',
    title: 'Why the voltage sags under load',
    summary: 'A current pulse: an instant drop, a slow drop, and a slow recovery.',
    base: { profile: 'pulse', soc0: 0.6, crate: 2, pulses: 3, pulseOn: 20, pulseOff: 40, capSpread: 0.03, socSpread: 0.05 },
    check: {
      question: 'The current pulse stops. What does the pack voltage do?',
      options: ['it jumps straight back to its rest value', 'it jumps up by R0·I at once, then creeps up as the RC pairs relax', 'it stays at the loaded value until the next pulse'],
      answer: 1,
      explain: 'R0 responds instantly, so the R0·I drop vanishes at once. The RC pairs hold their voltage and release it with their time constants. The voltage therefore recovers over seconds to minutes.',
    },
    steps: [
      {
        title: '1 · At rest: the open-circuit voltage',
        at: () => 29,
        window: (r) => span(r, 0, 160),
        channels: ['vpack', 'vocv', 'ipack'],
        look: 'With no current, the pack voltage equals the sum of the cells’ OCVs.',
        body: (st) => `No current flows. The pack shows ${formatV(st.vpack, false)}, the sum of the ${st.cells.length} cells’ open-circuit voltages (${formatV(st.vocv, false)}).`,
      },
      {
        title: '2 · The pulse starts: an instant drop',
        at: (r) => evT(r, 'load-on') + r.params.tick,
        window: (r) => span(r, 0, 160),
        channels: ['vpack', 'vocv', 'ipack'],
        look: 'A vertical step down at the very start of the pulse.',
        body: (st, m, r) => `The load draws ${formatA(st.I)}. The voltage falls at once by ${formatV(m.vSag0 ?? NaN, false)}. That is N·R0·I = ${r.params.n} × ${(r.params.r0 * 1000).toFixed(0)} mΩ × ${formatA(r.params.iDis)}.`,
      },
      {
        title: '3 · During the pulse: the RC pairs charge',
        at: (r) => evT(r, 'load-on') + r.params.pulseOn,
        window: (r) => span(r, 0, 160),
        channels: ['vpack', 'vpol', 'ipack'],
        look: 'The voltage keeps sinking while the current is constant.',
        body: (st, m) => `After ${m.sagT} s the drop has grown to ${formatV(m.vSagT ?? NaN, false)}. The RC pairs charge towards R·I: their polarisation is now ${formatV(st.vpol, false)} over the pack.`,
      },
      {
        title: '4 · Current off: jump, then slow recovery',
        at: (r) => evT(r, 'load-on') + r.params.pulseOn + 15,
        window: (r) => span(r, 0, 160),
        channels: ['vpack', 'vpol', 'ipack'],
        look: 'A vertical jump up, then a slow curve towards the OCV.',
        body: (st, m) => `The R0 drop is gone at once. The RC pairs still hold ${formatV(st.vpol, false)}, and they decay with τ1 and τ2. At the end of the rest, ${formatV(m.vRec ?? NaN, false)} of the drop is still there.`,
      },
    ],
  },
  {
    id: 'weakest',
    title: 'The weakest cell ends the discharge',
    summary: 'Series cells share one current. The first one to reach Vmin stops them all.',
    base: { profile: 'discharge', soc0: 0.9, crate: 1, capSpread: 0.03, socSpread: 0.05 },
    check: {
      question: 'In a series pack, the discharge ends when…',
      options: ['the average cell voltage reaches the cut-off', 'the first cell reaches the cut-off — the others still hold charge', 'every cell is completely empty'],
      answer: 1,
      explain: 'The BMS protects every cell. As soon as one cell reaches Vmin, it opens the contactor. The cells with more charge left cannot give it, so the weakest cell sets the usable capacity.',
    },
    steps: [
      {
        title: '1 · Same current, different cells',
        at: () => 600,
        channels: ['vmax', 'vmin', 'socmax', 'socmin'],
        look: 'The highest and lowest cell voltages run side by side, a few tens of mV apart.',
        body: (st) => `${st.cells.length} cells carry the same ${formatA(st.I)}. Their voltages differ because their SOCs differ: from ${formatV(st.cells[st.lo].v, false)} (cell ${st.lo + 1}) to ${formatV(st.cells[st.hi].v, false)} (cell ${st.hi + 1}).`,
      },
      {
        title: '2 · The voltages fan out near empty',
        at: (r) => evT(r, 'cutoff') - 300,
        channels: ['vmax', 'vmin', 'socmax', 'socmin'],
        look: 'Near the bottom of the OCV curve the highest and lowest cell voltages spread far apart.',
        body: (st) => `The OCV curve is steep below about 15 % SOC, so small SOC differences become large voltage differences. Cell ${st.lo + 1} is already at ${formatV(st.cells[st.lo].v, false)}.`,
      },
      {
        title: '3 · Cut-off: one cell stops the pack',
        at: (r) => evT(r, 'cutoff'),
        channels: ['vmin', 'vmax', 'ipack'],
        look: 'The current drops to zero the instant the lowest cell touches Vmin.',
        body: (_st, m, r) => `Cell ${m.cutCell} reached ${formatV(r.params.vmin, false)} after ${fmtDur(m.tDis ?? NaN)}. The pack delivered ${ah(m.qDis ?? NaN)}, while the mean SOC was still ${pc(m.socAtCut ?? NaN)}.`,
      },
      {
        title: '4 · Rest: the voltage bounces back',
        at: (r) => r.params.duration,
        channels: ['vmin', 'vmax', 'vpack'],
        look: 'After the cut-off every voltage climbs back up.',
        body: (_st, m) => `Without current, the R0 drop vanishes and the RC pairs relax. The pack rose by ${formatV(m.rebound ?? NaN, false)}. The weakest cell is still nearly empty.`,
      },
      {
        title: '5 · Counting the charge',
        at: (r) => r.params.duration,
        channels: ['soce', 'socavg', 'socmin'],
        look: 'The BMS estimate follows the mean SOC of the cells.',
        body: (_st, m) => `The BMS counted the current: SOC estimate ${pc(m.socEstEnd)}, true mean ${pc(m.socAvgEnd)}. The weakest cell is at ${pc(m.socMinEnd)}.`,
      },
    ],
  },
  {
    id: 'balance',
    title: 'Balancing recovers usable capacity',
    summary: 'Charge with the bleed resistors working, then discharge.',
    base: { profile: 'cycle', soc0: 0.3, balancing: 'on', capSpread: 0.03, socSpread: 0.05 },
    check: {
      question: 'How does passive balancing make more of the pack usable?',
      options: ['it moves charge from the high cells into the low cells', 'it bleeds the high cells, so the charger can keep filling the low cells', 'it increases the capacity of the weakest cell'],
      answer: 1,
      explain: 'Passive balancing only burns charge as heat. While charging, it holds back the high cells, so the low cells can be filled too. After the charge the cells are closer, and the weakest cell no longer cuts the discharge short so early.',
    },
    steps: [
      {
        title: '1 · Constant current: the same current into every cell',
        at: (r) => evT(r, 'cv') - 300,
        channels: ['ipack', 'vmax', 'vmin'],
        look: 'All cell voltages rise together; the highest leads.',
        body: (st) => `The charger pushes ${formatA(-st.I)}. The cells’ SOCs are ${(st.cells.reduce((a, c) => Math.max(a, c.s), 0) - st.cells.reduce((a, c) => Math.min(a, c.s), 100)).toFixed(1)} %-points apart.`,
      },
      {
        title: '2 · A cell reaches Vmax: constant voltage',
        at: (r) => evT(r, 'cv') + 300,
        channels: ['ipack', 'vmax', 'vmin'],
        look: 'The current starts to fall; the highest cell stays flat at Vmax.',
        body: (st, _m, r) => `Cell ${st.hi + 1} is held at ${formatV(r.params.vmax, false)}. The current falls to ${formatA(-st.I)}. ${st.bleeding.length ? `Bleeding: ${cellList(st.bleeding)}.` : ''}`,
      },
      {
        title: '3 · End of charge: the cells are close',
        at: (r) => evT(r, 'charge-end'),
        channels: ['socmax', 'socmin', 'ipack'],
        look: 'The highest and lowest SOC lines have come together.',
        body: (_st, m) => `SOC spread: ${m.spread0.toFixed(1)} %-points at the start, ${(m.spreadCh ?? NaN).toFixed(2)} %-points after the charge. The bleed resistors burnt ${wh(m.eBleed)}.`,
      },
      {
        title: '4 · Discharge: the capacity you can use',
        at: (r) => evT(r, 'cutoff'),
        channels: ['vmin', 'vmax', 'ipack'],
        look: 'The discharge runs until the weakest cell reaches Vmin.',
        body: (_st, m) => `The pack delivered ${ah(m.qDis ?? NaN)} before cell ${m.cutCell} reached the cut-off. Switch balancing off in Experiment to see how much less it gives.`,
      },
    ],
  },
]

export const BATTERY_EXPERIMENTS: Array<Experiment<BatteryParams, BatteryMeasurements>> = [
  {
    id: 'balancing',
    title: 'Switch balancing off',
    change: () => ({ profile: 'cycle', balancing: 'off' }),
    question: () => 'Charge, then discharge, with balancing switched off. The charge the pack delivers in the discharge…',
    choices: ['falls: the cells stay mismatched', 'stays the same', 'rises: no charge is burnt in the resistors'],
    judge: (b, a) => ((a.qDis ?? 0) < (b.qDis ?? 0) * 0.995 ? 0 : (a.qDis ?? 0) > (b.qDis ?? 0) * 1.005 ? 2 : 1),
    rows: ['qDis', 'spreadCh', 'eBleed'],
    why: (b, a) =>
      `Usable charge ${ah(b.qDis ?? NaN)} → ${ah(a.qDis ?? NaN)}. Without balancing the cells stay ${(a.spreadCh ?? NaN).toFixed(1)} %-points apart after the charge (instead of ${(b.spreadCh ?? NaN).toFixed(2)}). The charge stops when the highest cell is full, and the discharge stops when the lowest is empty.`,
  },
  {
    id: 'rate',
    title: 'Discharge twice as fast',
    change: (p) => ({ crate: p.crate * 2 }),
    question: () => 'The discharge current doubles. The charge the pack delivers before the cut-off…',
    choices: ['falls: the bigger drop reaches Vmin earlier', 'stays the same: the capacity is the same', 'rises'],
    judge: (b, a) => ((a.qDis ?? 0) < (b.qDis ?? 0) * 0.995 ? 0 : (a.qDis ?? 0) > (b.qDis ?? 0) * 1.005 ? 2 : 1),
    rows: ['qDis', 'eDis', 'vSag0'],
    why: (b, a) => `${ah(b.qDis ?? NaN)} → ${ah(a.qDis ?? NaN)}, ${wh(b.eDis ?? NaN)} → ${wh(a.eDis ?? NaN)}. The R0 and RC drops double, so the weakest cell reaches Vmin at a higher SOC. The energy falls even more, because the voltage is lower all the way.`,
  },
  {
    id: 'r0',
    title: 'Double the cell resistance R0',
    change: (p) => ({ r0: p.r0 * 2 }),
    question: () => 'Every cell’s R0 doubles (an aged pack). The energy delivered in the discharge…',
    choices: ['falls', 'stays the same', 'rises'],
    judge: (b, a) => ((a.eDis ?? 0) < (b.eDis ?? 0) * 0.995 ? 0 : (a.eDis ?? 0) > (b.eDis ?? 0) * 1.005 ? 2 : 1),
    rows: ['eDis', 'qDis', 'vSag0'],
    why: (b, a) => `${wh(b.eDis ?? NaN)} → ${wh(a.eDis ?? NaN)}. More of the cell voltage is lost across R0: less energy reaches the load, and the cut-off comes sooner.`,
  },
]

export function batteryPredictions(seed: number): Array<PredictTask<BatteryParams, BatteryMeasurements>> {
  const n = [6, 8, 10][seed % 3]
  const crate = [2, 3, 2.5][seed % 3]
  const off = [0.05, 0.1, 0.08][seed % 3]
  return [
    {
      id: 'sag',
      prompt: `Pulse test: ${n} cells in series, R0 = 15 mΩ each, 5 Ah cells, a ${crate} C pulse (${(crate * 5).toFixed(1)} A). By how much does the pack voltage drop the instant the pulse starts?`,
      params: { profile: 'pulse', cells: n, crate, soc0: 0.6, r0: 0.015, capacity: 5 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vSag0 ?? NaN,
      tolerance: 0.05,
      hint: 'At the first instant only R0 responds: the RC pairs need time. Each cell drops R0·I.',
      theory: (p) => `ΔV = N·R0·I = ${p.cells} × ${(p.r0 * 1000).toFixed(0)} mΩ × ${(p.crate * p.capacity).toFixed(1)} A = ${formatV(p.cells * p.r0 * p.crate * p.capacity, false)}`,
    },
    {
      id: 'weakest',
      prompt: 'Discharge at 1 C from 90 %. Cell 2 has the smallest capacity (−3 %); cell 3 starts with the lowest SOC (−8 %). Which cell ends the discharge?',
      params: { profile: 'discharge', soc0: 0.9, capSpread: 0.03, socSpread: 0.08, cells: 8 },
      kind: 'choice',
      choices: ['cell 2 (smallest capacity)', 'cell 3 (lowest starting SOC)', 'all cells at the same time'],
      answer: (m) => (m.cutCell === 2 ? 0 : m.cutCell === 3 ? 1 : 2),
      hint: 'Which cell has the least charge left above the cut-off: capacity × (SOC − SOC at cut-off)?',
      theory: (p) => {
        const rp = resolveBattery(p).params
        const one = (i: number) => usableTextbook({ ...rp, n: 1, q: [rp.q[i]] }, [rp.s0[i]], rp.iDis).q / 3600
        return `Charge above the cut-off, Q·(SOC − SOC at Vmin + polarisation): cell 2 ${one(1).toFixed(2)} Ah, cell 3 ${one(2).toFixed(2)} Ah. The cell with less ends the discharge.`
      },
    },
    {
      id: 'coulomb',
      prompt: `The current sensor reads ${formatA(off)} too high. A 5 Ah pack is discharged at 1 C from 90 % (about 50 min of load, plus the rests: about 61 min in all). By how many %-points is the coulomb-counting SOC too low at the end?`,
      params: { profile: 'discharge', soc0: 0.9, iOffset: off, capacity: 5, capSpread: 0 },
      kind: 'number',
      unit: '%-points',
      answer: (m) => -m.socEstErr,
      tolerance: 0.15,
      hint: 'The offset is counted as charge leaving the pack during the whole run: offset × time / capacity.',
      theory: (p) => `error = I_offset·T/Q = ${p.iOffset} A × T / (${p.capacity} Ah × 3600 s/h) over the run’s full duration T, rests included: about ${((100 * p.iOffset * 3640) / (p.capacity * 3600)).toFixed(2)} %-points for T ≈ 61 min. (Here every cell has exactly the nominal capacity; a capacity spread would add its own error.)`,
    },
    {
      id: 'energy',
      prompt: '8 cells in series (≈ 3.7 V each), 5 Ah, discharged at 1 C from 90 % until the first cell reaches 3.0 V. Predict the energy delivered.',
      params: { profile: 'discharge', soc0: 0.9, cells: 8, capacity: 5 },
      kind: 'number',
      unit: 'Wh',
      answer: (m) => m.eDis ?? NaN,
      tolerance: 0.1,
      hint: 'Energy ≈ usable charge × average pack voltage. The usable charge is a little below 90 % of 5 Ah.',
      theory: () => 'E = ∫V·I dt ≈ Q_usable × V_average ≈ 4.2 Ah × 28 V ≈ 118 Wh (the simulation integrates it exactly).',
    },
  ]
}

export const BATTERY_MEASURE_LABELS = {
  qDis: { label: 'Charge delivered', fmt: (v: number) => ah(v) },
  eDis: { label: 'Energy delivered', fmt: (v: number) => wh(v) },
  qCh: { label: 'Charge accepted', fmt: (v: number) => ah(v) },
  eCh: { label: 'Energy into the pack', fmt: (v: number) => wh(v) },
  tCut: { label: 'Cut-off at', fmt: (v: number) => fmtDur(v) },
  cutCell: { label: 'Cell that ends the discharge', fmt: (v: number) => `cell ${v}` },
  socAtCut: { label: 'Mean SOC at the cut-off', fmt: (v: number) => pc(v) },
  tCv: { label: 'CC → CV after', fmt: (v: number) => fmtDur(v) },
  tCharge: { label: 'Charge time', fmt: (v: number) => fmtDur(v) },
  spread0: { label: 'SOC spread at the start', fmt: (v: number) => `${v.toFixed(2)} %` },
  spreadCh: { label: 'SOC spread after the charge', fmt: (v: number) => `${v.toFixed(2)} %` },
  spreadEnd: { label: 'SOC spread at the end', fmt: (v: number) => `${v.toFixed(2)} %` },
  vSag0: { label: 'Instant drop at the load step', fmt: (v: number) => formatV(v, false) },
  vSagT: { label: 'Drop after the first seconds of load', fmt: (v: number) => formatV(v, false) },
  vRec: { label: 'Drop left after the first rest', fmt: (v: number) => formatV(v, false) },
  rebound: { label: 'Rebound after the cut-off', fmt: (v: number) => formatV(v, false) },
  socMinEnd: { label: 'Lowest cell SOC at the end', fmt: (v: number) => pc(v) },
  socMaxEnd: { label: 'Highest cell SOC at the end', fmt: (v: number) => pc(v) },
  socAvgEnd: { label: 'Mean SOC at the end', fmt: (v: number) => pc(v) },
  socEstEnd: { label: 'SOC estimate at the end (coulomb counting)', fmt: (v: number) => pc(v) },
  socEstErr: { label: 'SOC estimate error', fmt: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} %-points` },
  eBleed: { label: 'Energy burnt in the bleed resistors', fmt: (v: number) => wh(v) },
  vCellMin: { label: 'Lowest cell voltage in the run', fmt: (v: number) => formatV(v, false) },
  iPeak: { label: 'Peak current', fmt: (v: number) => formatA(v) },
}

/** The line under the basic parameters. */
export function batteryParamNote(p: ResolvedBattery): string {
  return `${p.n} × ${p.capacity} Ah cells · 1 C = ${formatA(p.iNom)} · balancing ${p.balancing === 'on' ? 'while charging' : 'off'}`
}

export function defaultBatteryRun(): BatteryRun {
  return simulateBattery(BAT_DEFAULTS)
}
