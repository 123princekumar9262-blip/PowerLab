import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import type { CurrentPath, EnergyModel, NextConsequence, StatusInfo } from '../../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import { nextRunEvent } from '../cursor.ts'
import type { RunEvent } from '../types.ts'
import {
  magEnergy,
  measureXf,
  regionOfMode,
  simulateXf,
  XF_DEFAULTS,
  xfOutputs,
  type XfMeasurements,
  type XfParams,
  type XfRegion,
  type XfRun,
} from './transformer.ts'
import { exactXf, textbookXf } from './transformerTheory.ts'

export { measureXf, simulateXf, XF_DEFAULTS }

/** The circuit at one sample of the run (the simulator's own state; no re-simulation). */
export interface XfState {
  k: number
  t: number
  v1: number
  v2: number
  /** The ideal transformer's output v1·N2/N1. */
  v2i: number
  vm: number
  i1: number
  i2: number
  /** i2·N2/N1: the secondary current as the primary sees it. */
  j: number
  im: number
  b: number
  h: number
  region: XfRegion
  lmNow: number
  djdt: number
  di1dt: number
  /** Stored energies [J]: magnetising field, leakages (both, referred), load inductance. */
  wm: number
  wlk: number
  wload: number
}

export function xfStateAt(r: XfRun, k: number): XfState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const region = regionOfMode(r.modes[i])
  const x = r.xs.map((a) => a[i])
  const tIn = i > 0 ? r.time[i] - 0.5 * p.dt : 0
  const o = xfOutputs(p, x, tIn, region)
  const lam = s.b[i] * p.n1 * p.ae
  return {
    k: i,
    t: r.time[i],
    v1: s.v1[i],
    v2: s.v2[i],
    v2i: s.v2i[i],
    vm: s.vm[i],
    i1: s.i1[i],
    i2: s.i2[i],
    j: s.i2r[i],
    im: s.im[i],
    b: s.b[i],
    h: s.h[i],
    region,
    lmNow: s.lm[i],
    djdt: o.djdt,
    di1dt: o.di1dt,
    wm: magEnergy(p, lam),
    wlk: 0.5 * p.ll1 * o.i1 * o.i1 + 0.5 * p.ll2r * o.j * o.j,
    wload: 0.5 * p.llr * o.j * o.j,
  }
}

const REGION_TEXT: Record<XfRegion, string> = { lin: 'core linear', 'sat+': 'core saturated (+)', 'sat−': 'core saturated (−)' }
const fmtB = (b: number) => `${b.toFixed(3)} T`

export function xfView(st: XfState, r: XfRun): StateView {
  const p = r.params
  return {
    badge: { text: REGION_TEXT[st.region], tone: st.region === 'lin' ? 'on' : 'off' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'primary voltage v1', v: formatV(st.v1) },
      { k: 'secondary voltage v2', v: formatV(st.v2) },
      { k: 'primary current i1', v: formatA(st.i1, true) },
      { k: 'secondary current i2', v: formatA(st.i2, true) },
      { k: 'magnetising current im', v: formatA(st.im, true), tone: st.region === 'lin' ? 'on-q' : 'bad' },
      { k: 'flux density B', v: fmtB(st.b), tone: Math.abs(st.b) > p.bsat ? 'bad' : 'ok' },
      { k: 'ideal v1·N2/N1', v: formatV(st.v2i), min: 'standard' },
      { k: 'i2·N2/N1', v: formatA(st.j, true), min: 'standard' },
      { k: 'voltage on Lm', v: formatV(st.vm), min: 'standard' },
      { k: 'Bsat', v: `${p.bsat} T`, min: 'standard' },
      { k: 'magnetising L now', v: formatSI(st.lmNow, 'H'), min: 'engineer' },
      { k: 'core field H', v: `${st.h.toFixed(0)} A/m`, min: 'engineer' },
      { k: 'energy in the core', v: formatSI(st.wm, 'J'), min: 'engineer' },
      { k: 'energy in the leakage', v: formatSI(st.wlk, 'J'), min: 'engineer' },
    ],
    path: pathText(st, r),
  }
}

/** Is the secondary current still turning round after the last change of the source polarity (square drive)? */
function reversing(st: XfState, r: XfRun): boolean {
  if (r.params.source !== 'square') return false
  const drive = st.v1 - r.params.voff
  return Math.abs(st.j) > 1e-9 && Math.sign(st.j) !== Math.sign(drive)
}

export function xfStatus(st: XfState, r: XfRun): StatusInfo {
  const p = r.params
  const sat = st.region !== 'lin'
  const headline = p.source === 'square' ? (st.v1 - p.voff >= 0 ? 'Bridge +V' : 'Bridge −V') : st.v1 >= 0 ? 'Source positive' : 'Source negative'
  const facts = [
    sat ? `core SATURATED (B = ${fmtB(st.b)})` : `core linear (B = ${fmtB(st.b)})`,
    st.vm >= 0 ? 'flux rising' : 'flux falling',
    reversing(st, r) ? 'secondary current reversing (leakage)' : `power to the load ${formatW(st.v2 * st.i2)}`,
  ]
  return { headline, facts, tone: sat ? 'off' : 'on' }
}

function pathText(st: XfState, r: XfRun): string {
  const p = r.params
  const load = p.lload > 0 ? 'RL + LL' : 'RL'
  if (Math.abs(st.j) < 1e-6 * Math.max(1, Math.abs(st.i1))) return `primary only: source → R1 → Ll1 → N1 (the magnetising current); the secondary carries no current now`
  return `primary: source → R1 → Ll1 → N1 · the shared flux links N2 · secondary: N2 → Ll2 → R2 → ${load}`
}

export function xfPath(st: XfState, r: XfRun): CurrentPath {
  const sec = Math.abs(st.j) >= 1e-6 * Math.max(1, Math.abs(st.i1))
  return {
    elements: ['source', 'r1', 'll1', 'primary', 'core', ...(sec ? ['secondary', 'll2', 'r2', 'load'] : [])],
    text: pathText(st, r),
    reasons: [
      `i1 = ${formatA(st.i1, true)} = i2·N2/N1 (${formatA(st.j, true)}) + im (${formatA(st.im, true)})`,
      st.region === 'lin' ? 'the core is linear: the same flux links both windings' : 'the core is saturated: the magnetising branch has collapsed and draws a large current',
    ],
  }
}

/** The next consequence, quoting the run's own next event (edge, saturation, current reversal). */
export function xfNextConsequence(r: XfRun, st: XfState): NextConsequence | null {
  const p = r.params
  const e = nextRunEvent(r, st.k)
  if (!e) return null
  const at = `t = ${formatTime(e.time)}`
  const dB = st.vm / (p.n1 * p.ae)
  const dev = e.device ?? ''
  if (e.kind === 'gate-on' || e.kind === 'gate-off')
    return {
      text: `B keeps ${dB >= 0 ? 'rising' : 'falling'} at ${formatSI(Math.abs(dB), 'T/s')} until the bridge reverses at ${at}; then the flux turns round and the load current has to reverse through the leakage inductance.`,
      time: e.time,
    }
  if (dev.startsWith('core:')) {
    const to = dev.split('→')[1]
    return to === 'lin'
      ? { text: `The flux falls back below Bsat at ${at}: the full magnetising inductance returns and the current spike ends.`, time: e.time }
      : { text: `The flux reaches Bsat at ${at}: the magnetising inductance collapses (${formatSI(p.lm, 'H')} → ${formatSI(p.lsat, 'H')}) and the primary current spikes.`, time: e.time }
  }
  if (dev.startsWith('i2:')) return { text: `The secondary current crosses zero at ${at}: the leakage inductance has finished turning it round, and power flows to the load again.`, time: e.time }
  return null
}

export function xfWhy(r: XfRun, st: XfState, m: XfMeasurements): WhyCard[] {
  const p = r.params
  const tb = textbookXf(p)
  const cards: WhyCard[] = []
  const lmText = formatSI(p.lm, 'H')
  if (st.region === 'lin')
    cards.push({
      id: 'now',
      question: 'Why is v2 a scaled copy of v1?',
      what: `Now v1 = ${formatV(st.v1)} and v2 = ${formatV(st.v2)}; the ideal transformer would give v1·N2/N1 = ${formatV(st.v2i)}.`,
      why: 'Both windings sit on the same core, so every turn sees the same rate of change of flux dΦ/dt. The voltage per turn is the same on both sides.',
      equation: 'v1/N1 ≈ v2/N2 = dΦ/dt   (Φ = B·Ae)',
      physics: `The small difference (${formatV(st.v2i - st.v2)}) is the voltage lost on the winding resistances and leakage inductances, which carry the load current.`,
      whatIf: 'Double N2 and v2 doubles; the core flux does not change, because it is set by the primary volt-seconds.',
    })
  else
    cards.push({
      id: 'now',
      question: 'Why does the primary current spike?',
      what: `The core is saturated: |B| = ${Math.abs(st.b).toFixed(3)} T > Bsat = ${p.bsat} T. The magnetising inductance has fallen from ${lmText} to ${formatSI(p.lsat, 'H')}.`,
      why: 'The core cannot carry more flux, so each further volt-second needs a very large magnetising current. Only the leakage and the winding resistance limit it.',
      equation: 'dim/dt = vm/Lsat,  Lsat = N1²·μ0·Ae/(lg + le/μsat)',
      physics: `Magnetising current now ${formatA(st.im, true)}, largest in the period ${formatA(m.imMax)}. A real bridge would trip its over-current protection or fail.`,
      whatIf: 'Fewer volt-seconds (higher frequency, lower voltage), more turns or a larger core keep B below Bsat.',
    })
  cards.push({
    id: 'im',
    question: 'Why does the primary carry more current than the load needs?',
    what: `SIMULATION: I1 = ${formatA(m.i1rms)} RMS, while I2·N2/N1 = ${formatA((m.i2rms * p.n2) / p.n1)} RMS. The extra is the magnetising current im (peak ${formatA(m.imMax)}).`,
    why: 'The core needs a current to set up its flux. It flows in the primary only; the load current is transferred to the secondary by the turns ratio.',
    equation: 'N1·i1 = N2·i2 + N1·im   ⇒   i1 = i2·N2/N1 + im',
    physics:
      p.source === 'square'
        ? `With a square voltage the flux, and so im, is a triangle: its peak is V·T/(4·Lm) = ${formatA(tb.imPk)} (Lm = ${lmText}). It does not depend on the load.`
        : `With a sine voltage im is a sine lagging v1 by 90°: its peak is V̂/(ω·Lm) ≈ ${formatA(tb.imPk)} (Lm = ${lmText}). It does not depend on the load.`,
    whatIf: 'Halve the load resistance: the load current doubles, im stays the same. Add an air gap: Lm falls and im grows.',
  })
  cards.push({
    id: 'flux',
    question: 'What sets the flux swing?',
    what: `SIMULATION: ΔB = ${m.dB.toFixed(3)} T peak-to-peak, peak |B| = ${m.bpk.toFixed(3)} T (Bsat = ${p.bsat} T).`,
    why: 'Faraday: the primary volt-seconds move the flux — the load and the inductance do not appear. Each half-period of +V raises B; −V lowers it again.',
    equation: p.source === 'square' ? `ΔB = V·(T/2)/(N1·Ae) = ${tb.dB.toFixed(3)} T` : `ΔB = 2·V̂/(ω·N1·Ae) = ${tb.dB.toFixed(3)} T`,
    physics: m.saturated ? 'The flux reaches Bsat for part of the period, so the swing is clipped there and the magnetising current pays for it.' : `The peak stays ${((1 - m.bpk / p.bsat) * 100).toFixed(0)} % below Bsat.`,
    whatIf: 'Halving the frequency doubles ΔB; doubling N1 halves it.',
  })
  cards.push({
    id: 'dc',
    question: 'Why must the average voltage on a transformer be zero?',
    what: `SIMULATION: the source offset is ${formatV(p.voff)}; the mean primary current is ${formatA(m.i1dc, true)} and the mean flux density ${m.bdc.toFixed(3)} T.`,
    why: 'In steady state no winding can hold a mean voltage (the flux would grow without limit), so the whole DC part of the source falls on the primary resistance. R1 is tiny, so the DC current is large — and it all magnetises the core.',
    equation: `I1dc = Voff/R1 = ${formatA(tb.i1dc, true)},  Bdc = Lm·I1dc/(N1·Ae)`,
    physics: m.saturated && Math.abs(p.voff) > 0 ? 'Here the DC bias pushes the flux into saturation once per period.' : 'A few millivolts of offset (a bridge whose two half-periods differ by a fraction of a percent) can be enough to saturate an ungapped core.',
    whatIf: 'A series (DC-blocking) capacitor or an air gap protects the core; current-mode control balances the half-periods.',
  })
  if (p.source === 'square')
    cards.push({
      id: 'leak',
      question: 'Why does v2 dip at every edge?',
      what: `SIMULATION: after each edge the secondary current needs ${m.tRev !== null ? formatTime(m.tRev) : '—'} to reverse; V2 is ${(m.regulation * 100).toFixed(2)} % below V1·N2/N1.`,
      why: 'The leakage inductances (flux that links only one winding) are in series with the load. They store energy and do not let the load current change instantly; while it turns round, little voltage reaches the load.',
      equation: `τ = (Ll1 + Ll2' + LL')/(R1 + R2' + RL') = ${formatTime(p.tauLk)},  t_rev ≈ τ·ln 2`,
      physics: `Ll2' = Ll2·(N1/N2)² = ${formatSI(p.ll2r, 'H')}: a secondary quantity seen from the primary scales with the turns ratio squared.`,
      whatIf: 'Ten times the leakage: a slower reversal and a lower output voltage (poorer regulation). Interleaved windings reduce leakage.',
    })
  if (p.view === 'startup')
    cards.push({
      id: 'inrush',
      question: 'Why is the switch-on current so much larger?',
      what: `SIMULATION: the primary current reaches ${formatA(m.iPeakRun)} after switch-on${m.tSat !== null ? `, the core saturating at ${formatTime(m.tSat)}` : ''}; peak B in the run ${m.bPeakRun.toFixed(3)} T.`,
      why: 'In steady state the flux swings symmetrically around zero. Starting from zero flux, the first half-period moves it by the whole swing in one direction — up to twice the normal peak ("flux doubling").',
      equation: `B after the first half-period ≈ ${tb.bFirst.toFixed(3)} T (twice the steady peak)`,
      physics: `The offset decays only with Lm/(R1 ∥ Rs) = ${formatTime(p.tauM)} — ${(p.tauM / p.period).toFixed(0)} periods.`,
      whatIf: p.source === 'sine' ? 'Switch a sine on at its voltage peak (φ = 90°): the flux starts at its natural value and there is no inrush.' : 'Start the bridge with a half-width first pulse: the flux starts centred and there is no inrush.',
    })
  return cards
}

// ── SIMULATION vs THEORY ───────────────────────────────────────────────────

export function compareXf(r: XfRun, m: XfMeasurements): CompareResult {
  const p = r.params
  const ex = exactXf(p)
  const tb = textbookXf(p)
  const rows: CompareRow[] = []
  const satNa = tb.saturates || m.saturated ? 'the core saturates: the linear formula does not apply' : undefined
  const startNa = p.view === 'startup' ? 'start-up: the period is not yet the steady state' : undefined
  const add = (
    key: string,
    label: string,
    unit: string,
    sim: number | null,
    exact: number | null,
    tbv: number | null,
    formula: string,
    notes: string[],
    opts: { scale?: number; na?: string; tol?: number; expected?: string } = {},
  ) => {
    if (sim === null || exact === null) return
    const den = opts.scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const tol = opts.tol ?? 0.005
    const textbook: TextbookValue | null = tbv === null && !opts.na ? null : { key, value: opts.na ? null : tbv, formula, assumptions: notes, notApplicable: opts.na }
    rows.push({
      key,
      label,
      unit,
      sim,
      exact,
      error,
      tolerance: tol,
      pass: error <= tol,
      absolute: opts.scale !== undefined,
      textbook,
      textbookError: textbook?.value != null ? (sim - textbook.value) / Math.max(Math.abs(textbook.value), 1e-30) : null,
      expected: opts.expected,
    })
  }
  const sq = p.source === 'square'
  const resistive = p.lload === 0
  add('v2rms', 'Secondary voltage, RMS', 'V', m.v2rms, ex.v2rms, startNa || satNa ? null : tb.v2rms, sq ? "(N2/N1)·RL'·I2'rms, I2' from τ (Lm neglected)" : 'phasor solution of the linear T-circuit', [sq ? 'square drive: the load current reverses exponentially through the leakage' : 'linear core, sinusoidal steady state'], { na: startNa || satNa || (!resistive && sq ? 'load inductance: V2 is not RL·I2' : undefined) })
  add('ratio', 'V2/V1 (RMS)', '', m.ratio, ex.ratio, startNa ? null : tb.v2rms !== null ? tb.v2rms / tb.v1rms : null, 'ideal: N2/N1 = ' + (p.n2 / p.n1).toFixed(4), ['the drop on R and leakage makes it a little lower'], { na: startNa || satNa })
  add('i1rms', 'Primary current, RMS', 'A', m.i1rms, ex.i1rms, tb.i1rms, sq ? '√(I2′² + îm²/3 + I1dc²)' : '√(|I1|²/2 + I1dc²)', ['load and magnetising currents add in quadrature'], { na: startNa || satNa })
  add('i2rms', 'Secondary current, RMS', 'A', m.i2rms, ex.i2rms, tb.i2rms, sq ? "(N1/N2)·I2'rms (Lm neglected)" : 'phasor solution', [], { na: startNa || satNa })
  add('imPk', 'Magnetising current, peak (half peak-to-peak)', 'A', m.imPk, ex.imPk, tb.imPk, sq ? 'V·T/(4·Lm)' : 'V̂m/(ω·Lm)', ['the R·i and leakage drops are neglected'], { na: startNa || satNa })
  add('dB', 'Flux swing ΔB', 'T', m.dB, ex.dB, tb.dB, sq ? 'V·(T/2)/(N1·Ae)' : '2·V̂m/(ω·N1·Ae)', ['the R·i and leakage drops are neglected'], { na: startNa || (m.saturated ? 'the swing is clipped by saturation' : undefined) })
  add('bpk', 'Peak flux density', 'T', m.bpk, ex.bpk, tb.bpk, '|Bdc| + ΔB/2', ['linear core'], { na: startNa || satNa })
  const iScale = Math.max(m.i1rms, 1e-9)
  add('i1dc', 'Mean primary current', 'A', m.i1dc, ex.i1dc, p.view === 'steady' ? tb.i1dc : null, 'Voff/R1', ['exact in steady state: no winding holds a mean voltage'], { scale: iScale })
  add('bdc', 'Mean flux density', 'T', m.bdc, ex.bdc, p.view === 'steady' && !satNa ? tb.bdc : null, 'Lm·I1dc/(N1·Ae)', ['linear core'], { scale: Math.max(m.bpk, 1e-9) })
  add('p1', 'Input power P1', 'W', m.p1, ex.p1, startNa || satNa ? null : tb.p1, 'P2 + R1·I1² + R2·I2²', ['no core loss modelled'], { scale: Math.max(Math.abs(ex.p1), 1e-9) })
  add('p2', 'Load power P2', 'W', m.p2, ex.p2, startNa || satNa ? null : tb.p2, "RL'·I2'²", [], { scale: Math.max(Math.abs(ex.p1), 1e-9) })
  add('eff', 'Efficiency P2/P1', '%', m.eff, ex.eff, startNa || satNa ? null : tb.eff, 'P2/P1', [], { scale: 1 })
  add('balance', 'Energy balance (P1 − P2 − losses)/P1', '%', m.balance, ex.balance, null, '', [], { scale: 1, tol: p.view === 'steady' ? 0.002 : 0.05 })
  add('regulation', 'Regulation 1 − V2/(V1·N2/N1)', '%', m.regulation, ex.regulation, startNa || satNa ? null : tb.regulation, '1 − V2/(V1·N2/N1)', ['resistance and leakage drops'], { scale: 1 })
  add('satFrac', 'Time saturated (fraction of the period)', '%', m.satFrac, ex.satFrac, null, '', [], { scale: 1 })
  if (sq && m.tRev !== null && ex.tRev !== null) {
    const resolved = ex.tRev > 8 * p.dt
    add('tRev', 'Secondary current reversal after the +V edge', 's', m.tRev, ex.tRev, startNa ? null : tb.tRev, 'τ·ln(1 + tanh(T/(4τ))) ≈ τ·ln 2', ['Lm neglected: the reversal is the leakage loop L/R'], {
      tol: 0.01,
      expected: resolved ? undefined : `the reversal (${formatTime(ex.tRev)}) lasts only a few time steps (Δt = ${formatTime(p.dt)}): the step cannot resolve it`,
    })
  }
  if (p.view === 'startup') {
    add('iPeakRun', 'Peak primary current after switch-on', 'A', m.iPeakRun, ex.iPeakRun, null, '', [])
    add('bPeakRun', 'Peak flux density after switch-on', 'T', m.bPeakRun, ex.bPeakRun, tb.bFirst, 'twice the steady peak (flux doubling)', ['drops neglected'], { na: m.tSat !== null ? 'the core saturates: the flux is clipped near Bsat' : undefined })
    if (m.tSat !== null || ex.tSat !== null) add('tSat', 'First saturation after switch-on', 's', m.tSat, ex.tSat, tb.tSat, sq ? 'N1·Ae·Bsat/V' : 'acos(cos φ − λs·ω/V̂)/ω − φ/ω', ['R·i and leakage drops neglected'])
  }
  return {
    rows,
    allPass: rows.every((x) => x.pass || !!x.expected),
    header: `SIMULATION: trapezoidal time-stepping of the T-equivalent circuit, every saturation and current reversal located by bisection${p.view === 'steady' ? ', the periodic steady state by shooting' : ''}. THEORY: the exact piecewise-linear solution (matrix exponential)${p.view === 'steady' ? ' and its own periodic steady state' : ''}, means and RMS by Gauss–Legendre quadrature. Textbook: the ideal transformer, volt-second balance, ${sq ? 'the leakage L/R transfer' : 'phasors'}.`,
    note: 'Core losses (hysteresis, eddy currents) are not modelled: the only losses are the winding resistances.',
  }
}

// ── Energy at the cursor ────────────────────────────────────────────────────

export function xfEnergy(st: XfState, m: XfMeasurements, r: XfRun): EnergyModel {
  const p = r.params
  const ledger = [
    { id: 'source', label: 'Source v1', watts: -st.v1 * st.i1, note: 'supplies v1·i1 (negative = supplying)' },
    { id: 'r1', label: 'Primary resistance R1', watts: p.r1 * st.i1 * st.i1, note: 'R1·i1² as heat' },
    { id: 'll1', label: 'Primary leakage Ll1', watts: p.ll1 * st.i1 * st.di1dt, note: 'stores ½·Ll1·i1² (+ storing, − releasing)' },
    { id: 'core', label: 'Core (magnetising)', watts: st.vm * st.im, note: 'vm·im: the core stores and returns its field energy' },
    { id: 'll2', label: 'Secondary leakage Ll2', watts: p.ll2r * st.j * st.djdt, note: 'stores ½·Ll2·i2²' },
    { id: 'r2', label: 'Secondary resistance R2', watts: p.r2 * st.i2 * st.i2, note: 'R2·i2² as heat' },
    { id: 'load', label: 'Load RL', watts: p.rload * st.i2 * st.i2, note: 'the useful power RL·i2²' },
    ...(p.lload > 0 ? [{ id: 'lload', label: 'Load inductance LL', watts: p.llr * st.j * st.djdt, note: 'stores ½·LL·i2²' }] : []),
  ]
  // largest stored energies of the run (for the bars)
  let wmMax = 1e-30
  let wlMax = 1e-30
  for (let k = 0; k < r.length; k++) {
    wmMax = Math.max(wmMax, magEnergy(p, r.signals.b[k] * p.n1 * p.ae))
    wlMax = Math.max(wlMax, 0.5 * p.ll1 * r.signals.i1[k] ** 2 + 0.5 * p.ll2r * r.signals.i2r[k] ** 2)
  }
  const stores = [
    { id: 'core', label: 'Core field ∫im·dλ', joules: st.wm, fraction: st.wm / wmMax, detail: `${st.vm * st.im >= 0 ? 'storing' : 'returning'} ${formatW(Math.abs(st.vm * st.im))}` },
    { id: 'leak', label: "Leakage ½·Ll1·i1² + ½·Ll2'·i2'²", joules: st.wlk, fraction: st.wlk / wlMax, detail: `${formatSI(st.wlk, 'J')}` },
  ]
  const balance = ledger.reduce((a, x) => a + x.watts, 0)
  return {
    ledger,
    stores,
    balance,
    tolerance: 1e-6 * Math.max(1e-12, ...ledger.map((x) => Math.abs(x.watts))) + 1e-9,
    summary: `Over the period: P1 = ${formatW(m.p1)} in, P2 = ${formatW(m.p2)} to the load, ${formatW(m.pcu1 + m.pcu2)} in the windings (efficiency ${(m.eff * 100).toFixed(2)} %).`,
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

export function xfEventLabel(e: RunEvent): string {
  if (e.kind === 'gate-on') return 'Bridge applies +V'
  if (e.kind === 'gate-off') return 'Bridge applies −V'
  const d = e.device ?? ''
  if (d.startsWith('core:')) return d.endsWith('lin') ? 'The core leaves saturation' : 'The core saturates'
  if (d.startsWith('i2:')) return d.endsWith('p') ? 'Secondary current reverses (to +)' : 'Secondary current reverses (to −)'
  return d || e.kind
}

export function xfEventWhy(e: RunEvent): string {
  const v = e.values
  const label = xfEventLabel(e)
  const why =
    e.kind === 'gate-on' || e.kind === 'gate-off'
      ? 'The bridge reverses the primary voltage: the flux turns round, and the load current must reverse too — through the leakage inductances, which slow it down.'
      : label === 'The core saturates'
        ? 'The flux reached Bsat: the magnetising inductance collapses and the primary current rises steeply.'
        : label === 'The core leaves saturation'
          ? 'The flux is back below Bsat: the full magnetising inductance returns.'
          : 'The secondary current passes through zero: from here the load receives power with the new polarity.'
  return `i1 = ${formatA(v.i1 ?? 0, true)}, i2 = ${formatA(v.i2 ?? 0, true)}, im = ${formatA(v.im ?? 0, true)}, B = ${(v.b ?? 0).toFixed(3)} T. ${why}`
}

// ── Learn ───────────────────────────────────────────────────────────────────

type L = Lesson<XfParams, XfRun, XfMeasurements, XfState>

/** Largest energy stored in the two leakage inductances during the run [J]. */
export function leakEnergyMax(r: XfRun): number {
  const p = r.params
  let w = 0
  for (let k = 0; k < r.length; k++) w = Math.max(w, 0.5 * p.ll1 * r.signals.i1[k] ** 2 + 0.5 * p.ll2r * r.signals.i2r[k] ** 2)
  return w
}
const T = (r: XfRun) => r.params.period

export const XF_LESSONS: L[] = [
  {
    id: 'ratio',
    title: 'Turns ratio and magnetising current',
    summary: 'V2 = V1·N2/N1, and the primary current is the load current plus a small triangle that magnetises the core.',
    base: { source: 'square', view: 'steady', voff: 0 },
    check: {
      question: 'You halve the load resistance, so the load current doubles. The magnetising current…',
      options: ['doubles as well', 'stays the same — it is set by the volt-seconds and Lm, not by the load', 'falls to half'],
      answer: 1,
      explain: 'im = λm/Lm and the flux is set by the primary volt-seconds. The load current is transferred to the secondary by the turns ratio and does not magnetise the core. (In the simulation im falls by a percent or two, only because the larger current drops a little more voltage on R1 and Ll1.)',
    },
    steps: [
      {
        title: '1 · The voltage follows the turns ratio',
        at: (r) => 0.3 * T(r),
        channels: ['v1', 'v2', 'v2i'],
        look: 'v2 (orange) sits just under the dashed ideal v1·N2/N1.',
        body: (_st, m, r) =>
          `N1:N2 = ${r.params.n1}:${r.params.n2}, so the ideal output is V1·N2/N1 = ${formatV((m.v1rms * r.params.n2) / r.params.n1, false)} RMS. SIMULATION: V2 = ${formatV(m.v2rms, false)} RMS — ${(m.regulation * 100).toFixed(2)} % lower, lost on the winding resistances and the leakage.`,
      },
      {
        title: '2 · The currents: load part plus magnetising part',
        at: (r) => 0.45 * T(r),
        channels: ['i1', 'i2r', 'im'],
        look: 'i1 (red) = the load current seen from the primary (purple) + the magnetising current (amber).',
        body: (st, m, r) =>
          `At this instant i1 = ${formatA(st.i1, true)} = i2·N2/N1 (${formatA(st.j, true)}) + im (${formatA(st.im, true)}). Over the period: I1 = ${formatA(m.i1rms)} RMS against I2·N2/N1 = ${formatA((m.i2rms * r.params.n2) / r.params.n1)} RMS — the magnetising current adds a little.`,
      },
      {
        title: '3 · The magnetising current is a triangle',
        at: (r) => 0.49 * T(r),
        channels: ['v1', 'b', 'im'],
        look: 'While +V is applied B and im ramp up; while −V is applied they ramp down.',
        body: (_st, m, r) =>
          `The flux swings ΔB = ${m.dB.toFixed(3)} T, set by the volt-seconds. With Lm = ${formatSI(r.params.lm, 'H')} that needs a magnetising current of ±${formatA(m.imPk)} (V·T/(4·Lm) = ${formatA((r.params.v * T(r)) / (4 * r.params.lm))}).`,
      },
      {
        title: '4 · Take the load away',
        params: { rload: 500 },
        at: (r) => 0.49 * T(r),
        channels: ['i1', 'im'],
        look: 'Almost no load: the primary current is now just the magnetising triangle.',
        body: (_st, m) => `With RL = 500 Ω the load takes almost nothing: I1 = ${formatA(m.i1rms)} RMS, mostly magnetising current (peak ${formatA(m.imPk)}). That triangle is set by the volt-seconds and Lm, not by the load: it was there all along, under the load current.`,
      },
    ],
  },
  {
    id: 'voltsec',
    title: 'Why the average voltage must be zero',
    summary: 'A tiny DC offset drives a large DC current through R1 — and walks the core into saturation.',
    base: { source: 'square', view: 'steady' },
    check: {
      question: 'A 48 V bridge has a 50 mV DC offset. What limits the DC current in the primary?',
      options: ['the magnetising inductance', 'only the primary resistance R1', 'the load resistance'],
      answer: 1,
      explain: 'In steady state the windings cannot hold a mean voltage, so the whole offset falls on R1: I1dc = Voff/R1. With R1 = 50 mΩ, 50 mV gives 1 A — all of it magnetising current.',
    },
    steps: [
      {
        title: '1 · Balanced drive',
        params: { voff: 0, f: 50e3 },
        at: (r) => 0.49 * T(r),
        channels: ['v1', 'b', 'im'],
        look: 'B swings symmetrically around zero.',
        body: (_st, m) => `Mean flux ${m.bdc.toFixed(3)} T, peak ${m.bpk.toFixed(3)} T, mean primary current ${formatA(m.i1dc, true)}.`,
      },
      {
        title: '2 · A 10 mV offset',
        params: { voff: 0.01, f: 50e3 },
        at: (r) => 0.49 * T(r),
        channels: ['v1', 'b', 'im'],
        look: 'The whole flux triangle has moved up.',
        body: (_st, m, r) => `Only 0.02 % of the voltage — yet the mean primary current is ${formatA(m.i1dc, true)} = Voff/R1 (R1 = ${formatSI(r.params.r1, 'Ω')}). It shifts the flux by ${m.bdc.toFixed(3)} T; the peak is now ${m.bpk.toFixed(3)} T.`,
      },
      {
        title: '3 · A 50 mV offset: saturation',
        params: { voff: 0.05, f: 50e3 },
        at: (r) => 0.49 * T(r),
        channels: ['b', 'i1', 'im'],
        look: 'At the top of each flux ramp the core saturates and the current spikes.',
        body: (_st, m) => `Mean current ${formatA(m.i1dc, true)}. The core is saturated ${(m.satFrac * 100).toFixed(1)} % of the time and the magnetising current peaks at ${formatA(m.imMax)} — the bridge sees a spike every period.`,
      },
      {
        title: '4 · Too many volt-seconds',
        params: { voff: 0, f: 15e3 },
        at: (r) => 0.49 * T(r),
        channels: ['v1', 'b', 'im'],
        look: 'No offset, but each half-period now lasts longer than the core can take.',
        body: (_st, m, r) => `At ${formatSI(r.params.f, 'Hz')} each half-period applies V·T/2 = ${formatSI((r.params.v * T(r)) / 2, 'V·s')}: the flux would need ±${(m.dB / 2).toFixed(3)} T or more, beyond Bsat = ${r.params.bsat} T. Saturated ${(m.satFrac * 100).toFixed(1)} % of the time, im peak ${formatA(m.imMax)}.`,
      },
    ],
  },
  {
    id: 'leakage',
    title: 'Leakage: voltage drop and slow current transfer',
    summary: 'Flux that links only one winding acts as an inductor in series with the load.',
    base: { source: 'square', view: 'steady', voff: 0 },
    check: {
      question: 'The leakage inductance is made ten times larger. After each edge the load current reverses…',
      options: ['faster', 'more slowly — and the output voltage drops', 'just as fast'],
      answer: 1,
      explain: 'The leakage is in series with the load: the current reverses with τ = L_leak/R_total. A larger τ means a longer reversal, during which the load gets little voltage, so V2 falls.',
    },
    steps: [
      {
        title: '1 · A small leakage',
        params: { ll1: 2e-6, ll2: 0.5e-6 },
        at: (r) => 0.5 * T(r) + 0.5 * (measureXf(r).tRev ?? 0),
        window: (r) => [0.4 * T(r), 0.7 * T(r)],
        channels: ['v1', 'v2', 'i2r'],
        look: 'At the edge the load current turns round in a fraction of a microsecond.',
        body: (_st, m, r) => `τ = (Ll1 + Ll2')/(R1 + R2' + RL') = ${formatTime(r.params.tauLk)}. SIMULATION: the current reverses ${m.tRev !== null ? formatTime(m.tRev) : '—'} after the edge; V2 is ${(m.regulation * 100).toFixed(2)} % below the ideal.`,
      },
      {
        title: '2 · Ten times the leakage',
        params: { ll1: 20e-6, ll2: 5e-6 },
        at: (r) => 0.5 * T(r) + 0.5 * (measureXf(r).tRev ?? 0),
        window: (r) => [0.4 * T(r), 0.7 * T(r)],
        channels: ['v1', 'v2', 'i2r'],
        look: 'The reversal now takes a visible part of the half-period; v2 lags behind v1.',
        body: (_st, m, r) => `τ = ${formatTime(r.params.tauLk)}: the reversal takes ${m.tRev !== null ? formatTime(m.tRev) : '—'}. During it the load sees little voltage, so V2 = ${formatV(m.v2rms, false)} RMS — ${(m.regulation * 100).toFixed(1)} % below V1·N2/N1.`,
      },
      {
        title: '3 · Leakage stores energy',
        params: { ll1: 20e-6, ll2: 5e-6 },
        at: (r) => 0.5 * T(r) + 0.05 * T(r),
        window: (r) => [0.4 * T(r), 0.7 * T(r)],
        channels: ['i1', 'i2r', 'v2'],
        look: 'The energy ½·L·i² in the leakage must be removed and rebuilt at each edge.',
        body: (_st, _m, r) => `At the top of each half-period the leakage holds ½·Ll1·i1² + ½·Ll2'·i2'² = ${formatSI(leakEnergyMax(r), 'J')} (SIMULATION). Each reversal must empty it and fill it again with the other polarity. In a real bridge this energy rings with the switches' capacitance — the reason for snubbers and soft switching.`,
      },
    ],
  },
  {
    id: 'inrush',
    title: 'Switch-on inrush',
    summary: 'Switch on at zero flux and the first half-period drives the core to twice its normal peak.',
    base: { view: 'startup', voff: 0 },
    check: {
      question: 'When is a sine-fed transformer best switched on?',
      options: ['at a voltage zero crossing', 'at the voltage peak', 'it makes no difference'],
      answer: 1,
      explain: 'In steady state the flux lags the voltage by 90°: at the voltage peak the flux is naturally zero, which is where it starts. At a zero crossing the flux should be at its negative peak; starting from zero instead, it climbs to twice the normal peak and saturates the core.',
    },
    steps: [
      {
        title: '1 · Square drive from rest',
        params: { source: 'square', f: 30e3 },
        at: (r) => (measureXf(r).tSat ?? 0.45 * T(r)) + 0.02 * T(r),
        window: (r) => [0, 3 * T(r)],
        channels: ['v1', 'b', 'i1'],
        look: 'B starts at zero and climbs for the whole first +V interval — into saturation.',
        body: (st, m, r) => `In steady state B would swing ±${(m.dB / 2).toFixed(3)} T. From rest the first +V interval drives it towards ${((r.params.v * T(r)) / 2 / (r.params.n1 * r.params.ae)).toFixed(3)} T: it saturates at ${m.tSat !== null ? formatTime(m.tSat) : '—'}. Now B = ${st.b.toFixed(3)} T and i1 = ${formatA(st.i1, true)}; the switch-on peak is ${formatA(m.iPeakRun)}.`,
      },
      {
        title: '2 · Sine switched on at a zero crossing',
        params: { source: 'sine', f: 20e3, phase: 0 },
        at: (r) => (measureXf(r).tSat ?? 0.45 * T(r)) + 0.05 * T(r),
        window: (r) => [0, 3 * T(r)],
        channels: ['v1', 'b', 'i1'],
        look: 'The same flux doubling: the first half-cycle saturates the core.',
        body: (_st, m) => `Switched on at v1 = 0: the flux heads for twice its normal peak. Peak B ${m.bPeakRun.toFixed(3)} T, peak current ${formatA(m.iPeakRun)} — against ${formatA(m.i1Max)} once the period repeats.`,
      },
      {
        title: '3 · Sine switched on at the peak',
        params: { source: 'sine', f: 20e3, phase: 90 },
        at: (r) => 0.5 * T(r),
        window: (r) => [0, 3 * T(r)],
        channels: ['v1', 'b', 'i1'],
        look: 'No inrush: the flux starts where the steady state has it.',
        body: (_st, m) => `Switched on at the voltage peak: peak B ${m.bPeakRun.toFixed(3)} T, peak current ${formatA(m.iPeakRun)}${m.tSat === null ? ' — the core never saturates' : ''}. The right switching instant removes the inrush.`,
      },
    ],
  },
]

// ── Experiments ─────────────────────────────────────────────────────────────

export const XF_EXPERIMENTS: Array<Experiment<XfParams, XfMeasurements>> = [
  {
    id: 'load',
    title: 'Double the load (halve RL)',
    change: (p) => ({ rload: p.rload / 2 }),
    question: () => 'The load resistance halves, so the load current doubles. What happens to the magnetising current?',
    choices: ['It stays the same; only the load part of i1 grows', 'It doubles as well', 'It falls'],
    judge: (b, a) => (Math.abs(a.imPk / b.imPk - 1) < 0.05 && a.i1rms > 1.5 * b.i1rms ? 0 : a.imPk > 1.5 * b.imPk ? 1 : 2),
    rows: ['imPk', 'i1rms', 'i2rms', 'dB'],
    why: (b, a) => `Magnetising current ${formatA(b.imPk)} → ${formatA(a.imPk)}, primary current ${formatA(b.i1rms)} → ${formatA(a.i1rms)} RMS, flux swing ${b.dB.toFixed(3)} → ${a.dB.toFixed(3)} T. The flux is set by the primary volt-seconds; the load current is cancelled in the core by the secondary's ampere-turns.`,
  },
  {
    id: 'turns',
    title: 'Double the secondary turns (load ×4: the same power)',
    change: (p) => ({ n2: p.n2 * 2, rload: p.rload * 4 }),
    question: () => 'N2 doubles (and the load resistance is made 4× larger, so it takes the same power). What happens?',
    choices: ['V2 doubles and the core flux stays the same', 'V2 doubles and the core flux doubles', 'V2 halves'],
    judge: (b, a) => (Math.abs(a.v2rms / b.v2rms - 2) < 0.1 ? (Math.abs(a.dB / b.dB - 1) < 0.05 ? 0 : 1) : 2),
    rows: ['v2rms', 'ratio', 'dB'],
    why: (b, a) => `V2 ${formatV(b.v2rms, false)} → ${formatV(a.v2rms, false)}, ΔB ${b.dB.toFixed(3)} → ${a.dB.toFixed(3)} T. Each secondary turn sees the same dΦ/dt, so twice the turns give twice the voltage; the flux depends only on the primary.`,
  },
  {
    id: 'offset',
    title: 'Add a 50 mV DC offset',
    change: (p) => ({ voff: p.voff + 0.05 }),
    question: () => 'The source gets a 50 mV DC offset (0.1 % of 48 V). What happens?',
    choices: ['A DC current Voff/R1 flows and the core saturates', 'Almost nothing — 50 mV is tiny', 'The output gets a 50 mV DC offset'],
    judge: (b, a) => (a.saturated && Math.abs(a.i1dc) > 10 * Math.abs(b.i1dc) + 0.1 ? 0 : Math.abs(a.bpk / b.bpk - 1) < 0.1 ? 1 : 2),
    rows: ['i1dc', 'bpk', 'imMax', 'satFrac'],
    why: (b, a, _p0, p1) => `Mean primary current ${formatA(b.i1dc, true)} → ${formatA(a.i1dc, true)} = Voff/R1 with R1 = ${formatSI(p1.r1, 'Ω')}. Peak B ${b.bpk.toFixed(3)} → ${a.bpk.toFixed(3)} T, largest magnetising current ${formatA(b.imMax)} → ${formatA(a.imMax)}. The secondary cannot carry DC, so all of it magnetises the core.`,
  },
  {
    id: 'freq',
    title: 'Lower the frequency to 30 %',
    change: (p) => ({ f: p.f * 0.3 }),
    question: () => 'The frequency drops to 30 %. What happens to the core?',
    choices: ['More volt-seconds per half-period: it saturates and the current spikes', 'The flux swing shrinks', 'Nothing — the voltage is the same'],
    judge: (b, a) => (a.saturated && a.imMax > 3 * b.imMax ? 0 : a.dB < b.dB ? 1 : 2),
    rows: ['bpk', 'imMax', 'satFrac'],
    why: (b, a) => `Peak B ${b.bpk.toFixed(3)} → ${a.bpk.toFixed(3)} T, largest magnetising current ${formatA(b.imMax)} → ${formatA(a.imMax)}. Each half-period lasts longer, so more volt-seconds reach the core: a transformer is designed for a minimum frequency (and a maximum voltage).`,
  },
  {
    id: 'leak',
    title: 'Ten times the leakage',
    change: (p) => ({ ll1: p.ll1 * 10, ll2: p.ll2 * 10 }),
    question: () => 'Both leakage inductances become ten times larger. What happens to the output?',
    choices: ['V2 drops and the load current reverses more slowly', 'Nothing — leakage inductance has no resistance', 'V2 rises'],
    judge: (b, a) => (a.v2rms < b.v2rms && (a.tRev ?? 0) > (b.tRev ?? 0) ? 0 : a.v2rms > b.v2rms ? 2 : 1),
    rows: ['v2rms', 'regulation', 'tRev'],
    why: (b, a) => `V2 ${formatV(b.v2rms, false)} → ${formatV(a.v2rms, false)}, regulation ${(b.regulation * 100).toFixed(2)} → ${(a.regulation * 100).toFixed(2)} %, reversal ${b.tRev !== null ? formatTime(b.tRev) : '—'} → ${a.tRev !== null ? formatTime(a.tRev) : '—'}. The leakage is a series inductance: it slows every reversal of the load current, and the load loses the volt-seconds spent on it.`,
  },
]

// ── Predict ─────────────────────────────────────────────────────────────────

export function xfPredictions(seed: number): Array<PredictTask<XfParams, XfMeasurements>> {
  const n2 = [5, 10, 40][seed % 3]
  const f = [30e3, 40e3, 50e3][(seed + 1) % 3]
  const voff = [0.005, 0.01, 0.015][(seed + 2) % 3]
  const mu0 = 4e-7 * Math.PI
  const lmOf = (p: XfParams) => (p.n1 * p.n1 * mu0 * p.ae) / (p.lg + p.le / p.mur)
  return [
    {
      id: 'v2',
      prompt: `A ±48 V square wave drives N1 = 20 turns; the secondary has N2 = ${n2} turns and a light load (RL = 50 Ω). Predict the secondary RMS voltage.`,
      params: { source: 'square', view: 'steady', n2, rload: 50, voff: 0 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.v2rms,
      tolerance: 0.03,
      hint: 'V2 = V1·N2/N1 (the RMS of a ±V square wave is V).',
      theory: (p) => `V2 ≈ V·N2/N1 = ${formatV((p.v * p.n2) / p.n1, false)} (the SIMULATION is a little lower: resistance and leakage drops)`,
    },
    {
      id: 'im',
      prompt: `±48 V square wave at ${f / 1e3} kHz on N1 = 20 turns; the magnetising inductance is Lm = ${formatSI(lmOf(XF_DEFAULTS), 'H')}. Predict the peak of the magnetising current.`,
      params: { source: 'square', view: 'steady', f, voff: 0 },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.imPk,
      tolerance: 0.05,
      hint: 'During +V (half a period) im rises by V·(T/2)/Lm, from −îm to +îm.',
      theory: (p) => `îm = V·T/(4·Lm) = ${formatA(p.v / (4 * p.f * lmOf(p)))} (the drops on R1 and Ll1 make the simulated value slightly lower)`,
    },
    {
      id: 'dB',
      prompt: `±48 V square wave at ${f / 1e3} kHz, N1 = 20 turns, core area Ae = 100 mm². Predict the peak-to-peak flux swing ΔB.`,
      params: { source: 'square', view: 'steady', f, voff: 0 },
      kind: 'number',
      unit: 'T',
      answer: (m) => m.dB,
      tolerance: 0.05,
      hint: 'ΔB = V·(T/2)/(N1·Ae).',
      theory: (p) => `ΔB = V/(2·f·N1·Ae) = ${(p.v / (2 * p.f * p.n1 * p.ae)).toFixed(3)} T (the SIMULATION is a few % lower: the R1 and leakage drops take some of the volt-seconds)`,
    },
    {
      id: 'dc',
      prompt: `The 48 V bridge has a DC offset of ${voff * 1e3} mV; the primary resistance is R1 = 50 mΩ. Predict the mean primary current.`,
      params: { source: 'square', view: 'steady', voff },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.i1dc,
      tolerance: 0.03,
      hint: 'In steady state no winding holds a mean voltage: the whole offset is across R1.',
      theory: (p) => `I1dc = Voff/R1 = ${formatA(p.voff / p.r1, true)}`,
    },
    {
      id: 'sat',
      prompt: 'A 48 V bridge at 50 kHz drives N1 = 20 turns on an ungapped core (Lm ≈ 1.26 mH, Bsat = 0.35 T, normal peak 0.12 T). It has a 50 mV DC offset (R1 = 50 mΩ). Does the core saturate?',
      params: { source: 'square', view: 'steady', voff: 0.05 },
      kind: 'choice',
      choices: ['Yes — the DC current biases the flux beyond Bsat', 'No — 50 mV is only 0.1 % of the voltage'],
      answer: (m) => (m.saturated ? 0 : 1),
      hint: 'I1dc = Voff/R1, and that current biases the flux by Lm·I1dc/(N1·Ae).',
      theory: (p) => {
        const lm = lmOf(p)
        return `I1dc = Voff/R1 = ${formatA(p.voff / p.r1)} ⇒ Bdc = Lm·I1dc/(N1·Ae) = ${((lm * p.voff) / p.r1 / (p.n1 * p.ae)).toFixed(2)} T by the linear formula — far beyond Bsat`
      },
    },
  ]
}
