import { measure, type Measurements } from '../measurements/measurements.ts'
import { runSimulation } from '../simulation/engine.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import type { CircuitId, DiodeId, LabParams, SignalId, SimulationResult } from '../types/simulation.ts'
import { formatA, formatSI } from '../utils/format.ts'
import { pick, rng, shuffle } from './common.ts'

/**
 * FAULT DIAGNOSIS — a real rectifier with ONE hidden fault, simulated by the rectifier engine.
 *
 * The faults are the engine's own fault injection (`LabParams.faults`, the one Rectifiers › Experiment uses:
 * open / shorted device, raised forward drop, disconnected phase, weak phase) plus two single-phase faults that
 * are plain circuit changes the engine simulates exactly: an open filter capacitor (the RC load becomes an R
 * load) and a dried-out capacitor (C at 10 %), and a missing freewheeling diode (Dfw removed).
 *
 * Nothing here is invented: the student sees the faulty run; the reveal runs the healthy circuit too and every
 * number in the comparison and in WHY is measured from those two runs. Which answers count as right is fixed
 * per case and validated by `tests/practice.test.ts`: an answer counts only when its own simulated evidence
 * (output waveform + phase voltages) is indistinguishable from the true fault's.
 */

export type FaultKind = 'open' | 'short' | 'high-vf' | 'disconnected' | 'weak' | 'cap-open' | 'cap-dried'
export type PartType = 'device' | 'phase' | 'capacitor'

/** What can be wrong with each kind of part — the "explain" choice, in plain words. */
export const KINDS_FOR: Record<PartType, FaultKind[]> = {
  device: ['open', 'short', 'high-vf'],
  phase: ['disconnected', 'weak'],
  capacitor: ['cap-open', 'cap-dried'],
}
export const KIND_TEXT: Record<FaultKind, { title: string; text: string }> = {
  open: { title: 'Open circuit', text: 'It never conducts, so every pulse that needs it is missing or comes from a lower voltage.' },
  short: { title: 'Short circuit', text: 'It conducts in both directions and connects two supply lines, drawing a large fault current.' },
  'high-vf': { title: 'Degraded (high forward drop)', text: 'It still conducts, but it drops a few volts more than the others, so the pulses it carries are lower.' },
  disconnected: { title: 'Disconnected (blown fuse)', text: 'The line carries no current at all: the rectifier works from the two remaining phases only.' },
  weak: { title: 'Low voltage', text: 'The phase is still connected, but its amplitude is lower than the other two.' },
  'cap-open': { title: 'Open (disconnected)', text: 'The capacitor no longer holds the output up: the output falls with the rectified sine every half-cycle.' },
  'cap-dried': { title: 'Lost most of its capacitance', text: 'It still smooths, but it discharges much faster between the charging peaks.' },
}

export type BenchId = 'b6' | 'b6l' | 'b3' | 'bc' | 'bf'
export interface Part {
  id: string
  label: string
  type: PartType
}
export interface Bench {
  id: BenchId
  title: string
  /** The catalogue topic that opens this circuit (links). */
  topic: string
  circuitId: CircuitId
  /** The healthy circuit. */
  params: LabParams
  nameplate: string[]
  parts: Part[]
  /** Evidence channels shown from the start, and the current-probe channels (cost a point). */
  channels: SignalId[]
  probes: SignalId[]
}

const DEV = (ids: string[]): Part[] => ids.map((id) => ({ id, label: id === 'Dfw' ? 'Freewheeling diode Dfw' : `Diode ${id}`, type: 'device' as const }))
const PHASES: Part[] = (['a', 'b', 'c'] as const).map((q) => ({ id: `phase-${q}`, label: `Phase ${q.toUpperCase()} supply`, type: 'phase' as const }))
const D6 = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']

/** A small supply impedance (0.2 Ω per phase) so a shorted diode draws a finite, realistic fault current. */
const TP: LabParams = { ...THREE_PHASE_DEFAULTS, threePhase: { sequence: 'abc', rs: 0.2, ls: 0 }, faults: {}, sim: { ...THREE_PHASE_DEFAULTS.sim, cycles: 4 } }
const SP: LabParams = { ...DEFAULT_PARAMS, sim: { ...DEFAULT_PARAMS.sim, cycles: 6 } }

export const BENCHES: Record<BenchId, Bench> = {
  b6: {
    id: 'b6',
    title: 'Three-phase 6-pulse diode bridge, resistive load',
    topic: '3ph-6pulse',
    circuitId: '3ph-bridge:R',
    params: TP,
    nameplate: ['12 V rms per phase, 50 Hz', 'Supply 0.2 Ω per phase', 'Load R = 10 Ω', 'Diodes: 0.7 V'],
    parts: [...DEV(D6), ...PHASES],
    channels: ['vin', 'vb', 'vc', 'vout', 'io'],
    probes: ['id', 'id2', 'id3', 'id4', 'id5', 'id6'],
  },
  b6l: {
    id: 'b6l',
    title: 'Three-phase 6-pulse diode bridge, R-L load',
    topic: '3ph-6pulse',
    circuitId: '3ph-bridge:RL',
    params: TP,
    nameplate: ['12 V rms per phase, 50 Hz', 'Supply 0.2 Ω per phase', 'Load R = 10 Ω, L = 10 mH', 'Diodes: 0.7 V'],
    parts: [...DEV(D6), ...PHASES],
    channels: ['vin', 'vb', 'vc', 'vout', 'io'],
    probes: ['id', 'id2', 'id3', 'id4', 'id5', 'id6'],
  },
  b3: {
    id: 'b3',
    title: 'Three-phase 3-pulse (half-wave) rectifier',
    topic: '3ph-3pulse',
    circuitId: '3ph-half-wave:R',
    params: TP,
    nameplate: ['12 V rms per phase, 50 Hz', 'Supply 0.2 Ω per phase', 'Load R = 10 Ω', 'Diodes: 0.7 V'],
    parts: [...DEV(['Da', 'Db', 'Dc']), ...PHASES],
    channels: ['vin', 'vb', 'vc', 'vout', 'io'],
    probes: ['id', 'id2', 'id3'],
  },
  bc: {
    id: 'bc',
    title: 'Single-phase bridge with a capacitor filter',
    topic: '1ph-bridge',
    circuitId: 'bridge:RC',
    params: { ...SP, load: { resistance: 20, inductance: SP.load.inductance, capacitance: 4700e-6 } },
    nameplate: ['12 V rms, 50 Hz', 'Filter C = 4700 µF', 'Load R = 20 Ω', 'Diodes: 0.7 V'],
    parts: [...DEV(['D1', 'D2', 'D3', 'D4']), { id: 'C', label: 'Filter capacitor C', type: 'capacitor' }],
    channels: ['vin', 'vout', 'io'],
    probes: ['id', 'id2'],
  },
  bf: {
    id: 'bf',
    title: 'Half-wave rectifier, R-L load with a freewheeling diode',
    topic: '1ph-half-wave',
    circuitId: 'half-wave:RL',
    params: { ...SP, control: { device: 'diode', alphaDeg: 0, freewheel: true }, sim: { ...SP.sim, cycles: 8 } },
    nameplate: ['12 V rms, 50 Hz', 'Load R = 10 Ω, L = 50 mH', 'Freewheeling diode Dfw', 'Diodes: 0.7 V'],
    parts: DEV(['D1', 'Dfw']),
    channels: ['vin', 'vout', 'io'],
    probes: ['id', 'ifw'],
  },
}

/** A kind of case; a case picks one of the template's parts at random (from the seed). */
export interface Template {
  id: string
  bench: BenchId
  kind: FaultKind
  parts: string[]
}
export const TEMPLATES: Template[] = [
  { id: '6p-open', bench: 'b6', kind: 'open', parts: D6 },
  { id: '6p-short', bench: 'b6', kind: 'short', parts: D6 },
  { id: '6p-vf', bench: 'b6', kind: 'high-vf', parts: D6 },
  { id: '6p-phase', bench: 'b6', kind: 'disconnected', parts: ['phase-a', 'phase-b', 'phase-c'] },
  { id: '6p-weak', bench: 'b6', kind: 'weak', parts: ['phase-a', 'phase-b', 'phase-c'] },
  { id: '6pl-open', bench: 'b6l', kind: 'open', parts: D6 },
  { id: '6pl-phase', bench: 'b6l', kind: 'disconnected', parts: ['phase-a', 'phase-b', 'phase-c'] },
  { id: '3p-open', bench: 'b3', kind: 'open', parts: ['Da', 'Db', 'Dc'] },
  { id: '3p-weak', bench: 'b3', kind: 'weak', parts: ['phase-a', 'phase-b', 'phase-c'] },
  { id: 'cap-open', bench: 'bc', kind: 'cap-open', parts: ['C'] },
  { id: 'cap-dried', bench: 'bc', kind: 'cap-dried', parts: ['C'] },
  { id: 'fw-open', bench: 'bf', kind: 'open', parts: ['Dfw'] },
]

export interface Answer {
  part: string
  kind: FaultKind
}
export interface FaultCase {
  /** Template id (the "distinct case" counted by progress). */
  id: string
  /** Template + part: one concrete fault. */
  key: string
  bench: Bench
  part: string
  kind: FaultKind
  /** Answers that count as right: the fault itself, plus any fault whose evidence is identical (see tests). */
  accepted: Answer[]
}

const RAISED_VF = 3
const WEAK_SCALE = 0.6
const DRIED = 0.1
const phaseOf = (part: string) => part.replace('phase-', '') as 'a' | 'b' | 'c'

/** The faulty circuit: parameters and circuit id that the engine simulates. */
export function faultyCircuit(bench: Bench, part: string, kind: FaultKind): { params: LabParams; circuitId: CircuitId } {
  const p = bench.params
  switch (kind) {
    case 'open':
    case 'short':
      if (part === 'Dfw') return { params: { ...p, control: { ...p.control!, freewheel: false } }, circuitId: bench.circuitId }
      return { params: { ...p, faults: { diode: { id: part as DiodeId, kind } } }, circuitId: bench.circuitId }
    case 'high-vf':
      return { params: { ...p, faults: { vfOverride: { id: part as DiodeId, vf: RAISED_VF } } }, circuitId: bench.circuitId }
    case 'disconnected':
      return { params: { ...p, faults: { missingPhase: phaseOf(part) } }, circuitId: bench.circuitId }
    case 'weak':
      return { params: { ...p, faults: { imbalance: { phase: phaseOf(part), scale: WEAK_SCALE } } }, circuitId: bench.circuitId }
    case 'cap-open':
      return { params: p, circuitId: bench.circuitId.replace(':RC', ':R') as CircuitId }
    case 'cap-dried':
      return { params: { ...p, load: { ...p.load, capacitance: p.load.capacitance * DRIED } }, circuitId: bench.circuitId }
  }
}

/**
 * Which (part, kind) answers the engine can simulate on a bench: every device / phase fault on the three-phase
 * benches; on the single-phase benches only the capacitor and freewheeling-diode faults (the engine's fault
 * injection is three-phase only), so the other choices there are distractors the evidence rules out.
 */
export function simulable(bench: Bench, part: string, kind: FaultKind): boolean {
  if (bench.circuitId.startsWith('3ph')) return bench.parts.some((x) => x.id === part && KINDS_FOR[x.type].includes(kind))
  if (bench.id === 'bc') return part === 'C'
  return part === 'Dfw' && kind === 'open'
}

function acceptedFor(bench: Bench, part: string, kind: FaultKind): Answer[] {
  const own: Answer = { part, kind }
  // 3-pulse: each phase feeds exactly one diode, so an open Dx and a disconnected phase x leave the same evidence
  // (validated in the tests): both answers are right.
  if (bench.id === 'b3' && kind === 'open') return [own, { part: `phase-${part.slice(1).toLowerCase()}`, kind: 'disconnected' }]
  return [own]
}

export function makeCase(t: Template, part: string): FaultCase {
  const bench = BENCHES[t.bench]
  return { id: t.id, key: `${t.id}:${part}`, bench, part, kind: t.kind, accepted: acceptedFor(bench, part, t.kind) }
}

export const ROUND = 5

/** A round of cases from a set number: distinct templates, at most two per circuit family, parts at random. */
export function roundCases(seed: number, n = ROUND): FaultCase[] {
  const rand = rng(seed)
  const family = (b: BenchId) => (b === 'b6l' ? 'b6' : b)
  const count: Record<string, number> = {}
  const out: FaultCase[] = []
  for (const t of shuffle(TEMPLATES, rand)) {
    const f = family(t.bench)
    if ((count[f] ?? 0) >= 2) continue
    count[f] = (count[f] ?? 0) + 1
    out.push(makeCase(t, pick(t.parts, rand)))
    if (out.length === n) break
  }
  return out
}

// ── Simulation ──────────────────────────────────────────────────────────────

export interface BenchRun {
  result: SimulationResult
  m: Measurements
  /** Per device: largest forward and most negative current over the measurement window (last cycle). */
  peaks: Record<string, { max: number; min: number }>
}

export function runCircuit(params: LabParams, circuitId: CircuitId): BenchRun {
  const result = runSimulation(params, circuitId)
  const m = measure(result)
  const i0 = Math.max(0, result.trace.length - 1 - Math.round(result.params.period / result.params.dt))
  const peaks: BenchRun['peaks'] = {}
  for (const d of result.trace.diodes) {
    let max = 0
    let min = 0
    for (let i = i0; i < result.trace.length; i++) {
      if (d.current[i] > max) max = d.current[i]
      if (d.current[i] < min) min = d.current[i]
    }
    peaks[d.id] = { max, min }
  }
  return { result, m, peaks }
}
export const runHealthy = (c: FaultCase) => runCircuit(c.bench.params, c.bench.circuitId)
export function runFaulty(c: FaultCase): BenchRun {
  const f = faultyCircuit(c.bench, c.part, c.kind)
  return runCircuit(f.params, f.circuitId)
}

// ── Judging ─────────────────────────────────────────────────────────────────

export const PART_POINTS = 2
export const KIND_POINTS = 1
export const PROBE_COST = 1
export const CASE_POINTS = PART_POINTS + KIND_POINTS

export interface Judgement {
  partOk: boolean
  kindOk: boolean
  points: number
}
export function judge(c: FaultCase, a: Answer, probed: boolean): Judgement {
  const partOk = c.accepted.some((x) => x.part === a.part)
  const kindOk = c.accepted.some((x) => x.part === a.part && x.kind === a.kind)
  const raw = (partOk ? PART_POINTS : 0) + (kindOk ? KIND_POINTS : 0)
  return { partOk, kindOk, points: Math.max(0, raw - (probed && raw > 0 ? PROBE_COST : 0)) }
}

export const partLabel = (b: Bench, id: string) => b.parts.find((p) => p.id === id)?.label ?? id
export const answerText = (b: Bench, a: Answer) => `${partLabel(b, a.part)} — ${KIND_TEXT[a.kind].title.toLowerCase()}`

// ── Reveal: healthy vs faulty, from the two runs ────────────────────────────

export interface CompareRow {
  label: string
  healthy: string
  faulty: string
  /** Relative change (null when not comparable). */
  rel: number | null
}

const V = (v: number) => formatSI(v, 'V')
const Hz = (v: number | null) => (v === null ? 'no ripple' : formatSI(v, 'Hz'))
const pct = (a: number, b: number) => (Math.abs(a) > 1e-9 ? (b - a) / Math.abs(a) : null)

export function compareRows(c: FaultCase, h: BenchRun, f: BenchRun): CompareRow[] {
  const rows: CompareRow[] = [
    { label: 'Output voltage, average', healthy: V(h.m.voutAvg), faulty: V(f.m.voutAvg), rel: pct(h.m.voutAvg, f.m.voutAvg) },
    { label: 'Ripple, peak-to-peak', healthy: V(h.m.ripplePP), faulty: V(f.m.ripplePP), rel: pct(h.m.ripplePP, f.m.ripplePP) },
    { label: 'Ripple frequency', healthy: Hz(h.m.rippleFrequency), faulty: Hz(f.m.rippleFrequency), rel: h.m.rippleFrequency && f.m.rippleFrequency ? pct(h.m.rippleFrequency, f.m.rippleFrequency) : null },
    { label: 'Lowest output voltage', healthy: V(h.m.voutMin), faulty: V(f.m.voutMin), rel: pct(h.m.voutMin, f.m.voutMin) },
    { label: 'Load current, average', healthy: formatA(h.m.ioAvg), faulty: formatA(f.m.ioAvg), rel: pct(h.m.ioAvg, f.m.ioAvg) },
  ]
  for (const id of devicesOf(c)) {
    const hp = h.peaks[id]
    const fp = f.peaks[id] ?? { max: 0, min: 0 }
    if (!hp) continue
    rows.push({ label: `${id} current, peak`, healthy: formatA(hp.max), faulty: formatA(fp.max), rel: pct(hp.max, fp.max) })
    if (fp.min < -1e-3 || hp.min < -1e-3) rows.push({ label: `${id} current, most negative`, healthy: formatA(hp.min, true), faulty: formatA(fp.min, true), rel: null })
  }
  return rows
}

/** The devices worth a row in the comparison: the faulty one, or the two fed by a faulty phase. */
function devicesOf(c: FaultCase): string[] {
  if (c.bench.parts.find((p) => p.id === c.part)?.type === 'device') return c.kind === 'short' ? D6 : [c.part]
  if (c.part.startsWith('phase-')) {
    const q = phaseOf(c.part)
    if (c.bench.id === 'b3') return [`D${q}`]
    return { a: ['D1', 'D4'], b: ['D3', 'D6'], c: ['D5', 'D2'] }[q]
  }
  return []
}

const change = (a: number, b: number, unit: string) => {
  const r = pct(a, b)
  const word = r === null || Math.abs(r) < 0.005 ? 'stayed at' : r > 0 ? `rose by ${(r * 100).toFixed(0)} % to` : `fell by ${(-r * 100).toFixed(0)} % to`
  return `${word} ${formatSI(b, unit)} (healthy: ${formatSI(a, unit)})`
}
/**
 * WHY — the fault explained with the measured numbers of the two runs (nothing estimated): what the faulty part
 * did, what the output did, and what gives the fault away.
 */
export function explainFault(c: FaultCase, h: BenchRun, f: BenchRun): string[] {
  const out: string[] = []
  const vdc = `The average output ${change(h.m.voutAvg, f.m.voutAvg, 'V')}`
  const ripple = `the ripple ${change(h.m.ripplePP, f.m.ripplePP, 'V')}`
  const pulses = (r: BenchRun) => (r.m.rippleFrequency ? Math.round(r.m.rippleFrequency / r.result.params.frequency) : 0)
  const freq =
    h.m.rippleFrequency !== null && f.m.rippleFrequency !== null && Math.abs(h.m.rippleFrequency - f.m.rippleFrequency) > 0.5
      ? ` The ripple frequency went from ${Hz(h.m.rippleFrequency)} to ${Hz(f.m.rippleFrequency)}: the output pattern now repeats ${pulses(f) === 1 ? 'only once' : `${pulses(f)} times`} per source cycle instead of ${pulses(h)} — the clearest symptom on a scope.`
      : ''
  const pk = (r: BenchRun, id: string) => r.peaks[id] ?? { max: 0, min: 0 }
  switch (c.kind) {
    case 'open': {
      if (c.part === 'Dfw') {
        out.push(
          `Without Dfw nothing carries the inductor current when vin turns negative, so it keeps D1 conducting and drags the output below zero: the lowest output went from ${V(h.m.voutMin)} (clamped near −Vf by Dfw) to ${V(f.m.voutMin)}.`,
          `${vdc}. Dfw carried up to ${formatA(pk(h, 'Dfw').max)} in the healthy circuit; without it, that current is forced back through D1 and the source.`,
        )
        break
      }
      out.push(`${c.part} never conducted: its peak current was ${formatA(pk(f, c.part).max)} (healthy: ${formatA(pk(h, c.part).max)}). Every time it should have taken the load current, ${c.bench.id === 'b3' ? 'the output had to follow a lower phase instead' : 'another, lower line voltage had to supply the load'}.`)
      out.push(`${vdc}, and ${ripple}.${freq}`)
      if (c.bench.id === 'b3') out.push(`In a 3-pulse rectifier each phase feeds exactly one diode, so an open ${c.part} and a disconnected phase ${c.part.slice(1)} leave identical waveforms (the simulation confirms it). Both answers count; a meter across the diode tells them apart on a real bench.`)
      else out.push(`Which diode? Find the missing pulses on the scope and the phase that should have been the ${['D1', 'D3', 'D5'].includes(c.part) ? 'highest' : 'lowest'} at that moment: ${c.part} is the ${['D1', 'D3', 'D5'].includes(c.part) ? 'upper' : 'lower'} diode of phase ${({ D1: 'A', D4: 'A', D3: 'B', D6: 'B', D5: 'C', D2: 'C' } as Record<string, string>)[c.part]}.`)
      break
    }
    case 'short': {
      const victims = D6.filter((id) => id !== c.part).sort((a, b) => pk(f, b).max - pk(f, a).max)
      out.push(`${c.part} conducted backwards: its current reached ${formatA(pk(f, c.part).min, true)} (a healthy diode never goes below 0 A). Through it, two supply lines are connected directly, and the fault current through ${victims[0]} peaked at ${formatA(pk(f, victims[0]).max)} — limited only by the 0.2 Ω supply impedance.`)
      out.push(`${vdc}, and ${ripple}.${freq} On a real bench the fuse or the diode would fail within milliseconds.`)
      break
    }
    case 'high-vf': {
      // the output loss while the degraded diode conducts, measured sample by sample against the healthy run
      const k = f.result.diodeIds.indexOf(c.part as DiodeId)
      const tr = f.result.trace
      const hv = h.result.trace.signals.vout!
      const fv = tr.signals.vout!
      const i0 = Math.max(0, tr.length - 1 - Math.round(f.result.params.period / f.result.params.dt))
      let s = 0
      let n = 0
      for (let i = i0; i < tr.length; i++)
        if (k >= 0 && tr.diodes[k].on[i]) {
          s += hv[i] - fv[i]
          n++
        }
      out.push(`${c.part} still conducted (peak ${formatA(pk(f, c.part).max)}), but while it did, the output was on average ${V(n ? s / n : 0)} lower than in the healthy bridge: its forward drop is ${RAISED_VF} V instead of 0.7 V.`)
      out.push(`${vdc} — only a little — and ${ripple}.${freq} A small loss of average voltage with a lopsided ripple is the signature of one tired device.`)
      break
    }
    case 'disconnected': {
      const q = c.part.slice(-1).toUpperCase()
      const devs = devicesOf(c)
      out.push(`Phase ${q} carried no current: ${devs.map((d) => `${d} peaked at ${formatA(pk(f, d).max)}`).join(', ')} (healthy: ${formatA(pk(h, devs[0]).max)}). Its voltage on the scope still looks normal — the source is fine, the line between it and the rectifier is broken.`)
      out.push(`${vdc}, and ${ripple}.${freq}${c.bench.circuitId.startsWith('3ph-bridge') ? ' The bridge now works from one line voltage only — like a single-phase bridge.' : ''}`)
      break
    }
    case 'weak': {
      const q = c.part.slice(-1)
      const sid: SignalId = q === 'a' ? 'vin' : q === 'b' ? 'vb' : 'vc'
      const peak = (r: BenchRun, s: SignalId) => {
        const x = r.result.trace.signals[s]!
        let m = 0
        for (let i = 0; i < x.length; i++) m = Math.max(m, x[i])
        return m
      }
      out.push(`Phase ${q.toUpperCase()} peaked at only ${V(peak(f, sid))} while the other phases reached ${V(peak(f, sid === 'vin' ? 'vb' : 'vin'))}. The pulses that use phase ${q.toUpperCase()} are lower, and its devices conduct for less of the cycle.`)
      out.push(`${vdc}, and ${ripple}.${freq}`)
      break
    }
    case 'cap-open':
      out.push(`With C disconnected nothing holds the output up between the peaks: it falls with the rectified sine, down to ${V(f.m.voutMin)} (healthy: never below ${V(h.m.voutMin)}). ${vdc}, and ${ripple}.`)
      out.push(`The diodes' peak current ${change(h.m.idPeak, f.m.idPeak, 'A')}: they no longer recharge a capacitor in short, tall pulses — they just feed R.`)
      break
    case 'cap-dried': {
      const rc = (r: BenchRun) => r.result.params.resistance * r.result.params.capacitance
      out.push(`C is now ${(DRIED * 100).toFixed(0)} % of its rated value, so the time constant R·C dropped from ${formatSI(rc(h), 's')} to ${formatSI(rc(f), 's')}: between the peaks the output sags much further, down to ${V(f.m.voutMin)} (healthy: ${V(h.m.voutMin)}).`)
      out.push(`${vdc}, and ${ripple}. The diodes' peak current ${change(h.m.idPeak, f.m.idPeak, 'A')}. Unlike an open capacitor, the output still curves (an exponential decay, not the sine).`)
      break
    }
  }
  return out
}

/** Expected (healthy) values a technician would know from the datasheet — from the healthy run. */
export function healthyReference(h: BenchRun): Array<[string, string]> {
  return [
    ['Output voltage, average', V(h.m.voutAvg)],
    ['Ripple, peak-to-peak', V(h.m.ripplePP)],
    ['Ripple frequency', Hz(h.m.rippleFrequency)],
  ]
}
