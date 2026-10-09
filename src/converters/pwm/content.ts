import type { Experiment, Lesson, PredictTask, StateView, WhyCard } from '../../lab/types.ts'
import { formatSI, formatTime, formatV } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import type { PwmMeasurements } from './analysis.ts'
import { carrierAt, comparedAt, gateFromEdges, referenceAt, type PwmParams, type PwmRun } from './modulator.ts'

/** The modulator's state at one instant (all from the simulated run). */
export interface PwmState {
  k: number
  t: number
  carrier: number
  ref: number
  cmp: number
  gate: boolean
  gh: boolean
  gl: boolean
  vout: number
  vavg: number
  /** Carrier period index and position in it (0 … 1). */
  cycle: number
  u: number
  /** The pulse (ON interval) containing t or the next one: start, end. */
  pulse: { start: number; end: number } | null
  /** Local duty of the carrier period containing t (from the edges). */
  localDuty: number
  /** Time of the next comparator edge. */
  nextEdge: number | null
}

export function pwmStateAt(r: PwmRun, k: number): PwmState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const t = r.time[i]
  const s = r.signals
  const P = p.period
  const tm = i === 0 ? 1e-15 : t - p.dt / 2
  const cycle = Math.floor(tm / p.tc)
  const t0 = cycle * p.tc
  // Edges in absolute time around t.
  const abs: Array<{ t: number; rising: boolean }> = []
  const base = Math.floor(tm / P)
  for (const m of [base - 1, base, base + 1]) for (const e of r.edges) abs.push({ t: m * P + e.t, rising: e.rising })
  abs.sort((a, b) => a.t - b.t)
  // Local duty: ON time inside [t0, t0 + Tc).
  let on = 0
  let state = gateFromEdges(r.edges, P, t0 + 1e-15)
  let tt = t0
  for (const e of abs) {
    if (e.t <= t0 || e.t >= t0 + p.tc) continue
    if (state) on += e.t - tt
    tt = e.t
    state = e.rising
  }
  if (state) on += t0 + p.tc - tt
  const g = s.gate[i] > 0.5
  let pulse: PwmState['pulse'] = null
  const before = [...abs].reverse().find((e) => e.t <= tm && e.rising)
  const after = abs.find((e) => e.t > (before?.t ?? tm) && !e.rising)
  if (g && before && after) pulse = { start: before.t, end: after.t }
  const nextEdge = abs.find((e) => e.t > tm)?.t ?? null
  return {
    k: i,
    t,
    carrier: carrierAt(p, tm),
    ref: referenceAt(p, tm),
    cmp: comparedAt(p, tm),
    gate: g,
    gh: s.gh[i] > 0.5,
    gl: s.gl[i] > 0.5,
    vout: s.vout[i],
    vavg: s.vavg[i],
    cycle,
    u: tm / p.tc - cycle,
    pulse,
    localDuty: on / p.tc,
    nextEdge,
  }
}

export function pwmView(st: PwmState, r: PwmRun): StateView {
  const p = r.params
  return {
    badge: { text: st.gate ? 'Gate HIGH (r > c)' : 'Gate LOW (r < c)', tone: st.gate ? 'on' : 'off' },
    rows: [
      { k: 't', v: `${formatTime(st.t)} · carrier period ${st.cycle + 1}, ${(st.u * 100).toFixed(1)} %`, full: true },
      { k: 'carrier c', v: st.carrier.toFixed(4) },
      { k: p.sampling === 'natural' ? 'reference r' : 'held sample r', v: st.cmp.toFixed(4) },
      { k: 'comparator', v: st.gate ? 'r > c → HIGH' : 'r < c → LOW', tone: st.gate ? 'on-q' : 'off', full: true },
      { k: 'vout', v: formatV(st.vout) },
      { k: 'local duty', v: `${(st.localDuty * 100).toFixed(2)} %` },
      { k: 'vavg (1 carrier period)', v: formatV(st.vavg), full: true, min: 'standard' },
      { k: 'gate GH', v: st.gh ? 'ON' : 'OFF', tone: st.gh ? 'on-q' : 'off', min: 'engineer' },
      { k: 'gate GL', v: st.gl ? 'ON' : 'OFF', tone: st.gl ? 'on-d' : 'off', min: 'engineer' },
      { k: 'continuous ref', v: st.ref.toFixed(4), min: 'engineer' },
      { k: 'next edge', v: st.nextEdge !== null ? formatTime(st.nextEdge) : '—', min: 'engineer' },
    ],
  }
}

export function pwmWhy(r: PwmRun, st: PwmState, m: PwmMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const rName = p.sampling === 'natural' ? 'reference' : 'held sample of the reference'
  cards.push({
    id: 'gate',
    question: `Why is the gate ${st.gate ? 'HIGH' : 'LOW'}?`,
    what: `The comparator sees the ${rName} r = ${st.cmp.toFixed(4)} and the carrier c = ${st.carrier.toFixed(4)}.`,
    why: st.gate ? `r is above the carrier, so the comparator output is HIGH and the upper switch is commanded ON: vout = ${formatV(st.vout)}.` : `The carrier has risen above r, so the comparator output is LOW and the lower switch is commanded ON: vout = ${formatV(st.vout)}.`,
    equation: `g = (r > c) = (${st.cmp.toFixed(3)} ${st.gate ? '>' : '<'} ${st.carrier.toFixed(3)})`,
    physics: 'A comparator turns a slowly varying wish (the reference) into on/off commands a switch can execute without loss. The information is in the TIMING of the edges.',
    whatIf: `If r rose by 0.1, the crossing would move by ${formatTime((0.1 * p.tc) / (p.carrier === 'triangle' ? 4 : 2))} on each ${p.carrier === 'triangle' ? 'slope' : 'ramp'}: the pulse gets wider.`,
  })
  const ideal = (1 + st.cmp) / 2
  cards.push({
    id: 'width',
    question: 'Why is this pulse this wide?',
    what: `In this carrier period the gate is HIGH for ${(st.localDuty * 100).toFixed(2)} % of Tc = ${formatTime(p.tc)}.`,
    why:
      p.carrier === 'triangle'
        ? `The triangle climbs from −1 to +1 in Tc/2 and falls back: it stays below r for a fraction (1 + r)/2 of the period. With r = ${st.cmp.toFixed(4)} that is ${(ideal * 100).toFixed(2)} %${p.sampling === 'natural' && p.reference === 'sine' ? ' (r changes a little during the period, so the measured value differs slightly)' : ''}.`
        : `The sawtooth rises from −1 to +1 once per period; the gate is HIGH from the reset until the ramp crosses r: a fraction (1 + r)/2 = ${(ideal * 100).toFixed(2)} %.`,
    equation: `D = (1 + r)/2 = ${(ideal * 100).toFixed(2)} %`,
    physics: 'Pulse WIDTH modulation: the width of each pulse — not its height — carries the reference.',
    whatIf: p.bits ? `With a ${p.bits}-bit counter the width can only take ${2 ** p.bits} values: steps of ${(100 / 2 ** p.bits).toFixed(2)} %.` : 'A digital PWM with an N-bit counter could only produce 2^N different widths (Advanced → counter resolution).',
  })
  cards.push({
    id: 'avg',
    question: 'Why does the average follow the reference?',
    what: `Averaged over the last carrier period the output is ${formatV(st.vavg)}; the reference asks for ${formatV(p.output === 'bipolar' ? (st.ref * p.vdc) / 2 : ((1 + st.ref) * p.vdc) / 2)}.`,
    why: `Each period the output spends a fraction D at the high level and 1 − D at the low level, so its average is ${p.output === 'bipolar' ? '(2D − 1)·Vdc/2 = r·Vdc/2' : 'D·Vdc = (1 + r)·Vdc/2'}. An inductive load, a motor or an LC filter responds to that average and barely to the fast pulses.`,
    equation: p.output === 'bipolar' ? 'vavg = (2D − 1)·Vdc/2 = r·Vdc/2' : 'vavg = D·Vdc',
    physics: `The pulse train = its slow average + fast components at the carrier frequency and its multiples (${formatSI(p.fcEff, 'Hz')}, ${formatSI(2 * p.fcEff, 'Hz')}, …).`,
    whatIf: p.reference === 'sine' ? `Over a whole cycle the slow part is the fundamental: SIMULATION ${formatV(m.v1, false)} peak (THEORY M·Vdc/2 = ${formatV((p.m * p.vdc) / 2, false)}).` : `The average is set by D only: half the duty, half the ${p.output === 'bipolar' ? 'distance from −Vdc/2' : 'average'}.`,
  })
  cards.push({
    id: 'harm',
    question: p.reference === 'sine' ? `Why are there harmonics near ${p.mf}·f1?` : 'Why does the spectrum have harmonics of fc?',
    what:
      p.reference === 'sine'
        ? `The largest components after the fundamental sit at ${p.mf}·f1 and its sidebands (SIMULATION: ${formatV(m.at[p.mf] ?? 0, false)} at h = ${p.mf}).`
        : `The pulse train repeats every Tc, so its components are fc, 2fc, 3fc… (SIMULATION: ${formatV(m.at[1] ?? 0, false)} at fc).`,
    why: `Every carrier period produces one pulse: the switching repeats at fc = ${formatSI(p.fcEff, 'Hz')}, so the "switching noise" sits at fc and its multiples${p.reference === 'sine' ? ', split into sidebands by the slowly changing width' : ''}.`,
    equation: p.reference === 'sine' ? 'h = m·mf ± n  (m = 1, 2, …)' : '|c_h| = (2·Vdc/(h·π))·|sin(h·π·D)|',
    physics: 'Raising the carrier frequency pushes these components away from the reference, where a small filter or the load inductance removes them — at the price of more switching losses.',
    whatIf: p.reference === 'sine' ? `With mf = ${2 * p.mf} the first carrier group would sit near h = ${2 * p.mf}.` : 'At D = 50 % every even harmonic vanishes (sin(h·π/2) = 0 for even h).',
  })
  if (p.sampling !== 'natural')
    cards.push({
      id: 'sample',
      question: 'Why is the reference held (staircase)?',
      what: `The comparator does not see the continuous reference (${st.ref.toFixed(4)}) but a sample of it held for ${p.sampling === 'regular-sym' ? 'a whole' : 'half a'} carrier period: ${st.cmp.toFixed(4)}.`,
      why: 'A digital controller computes the pulse width once (symmetric) or twice (asymmetric) per carrier period from a sampled value. Between samples the reference is frozen.',
      equation: p.sampling === 'regular-sym' ? 'r[k] = r(t at the carrier peak), held until the next peak' : 'r[k] = r(t at each peak and valley)',
      physics: 'Sampling delays the reference and distorts it slightly: small low-order harmonics appear that natural sampling does not produce.',
      whatIf: `SIMULATION: 3rd harmonic ${formatV(m.at[3] ?? 0, false)} here; with natural sampling it is (practically) zero.`,
    })
  if (p.td > 0)
    cards.push({
      id: 'dead',
      question: st.gh || st.gl ? 'What is dead time?' : 'Why are both gates OFF?',
      what: `GH is ${st.gh ? 'ON' : 'OFF'}, GL is ${st.gl ? 'ON' : 'OFF'}.`,
      why: `After every command edge both gates stay OFF for td = ${formatTime(p.td)} before the new switch turns ON, so the two switches of a leg are never ON together (that would short the DC supply).`,
      equation: 'GH = g delayed at turn-on by td;  GL = not g delayed at turn-on by td',
      physics: 'During the dead time the load current flows through a diode, so the output voltage then depends on the current direction — a small voltage error the inverter modules show.',
      whatIf: `Volt-seconds per edge pair at stake: Vdc·td = ${formatSI(p.vdc * p.td, 'V·s')}, i.e. up to ${formatV(p.vdc * p.td * p.fcEff, false)} of average voltage error.`,
    })
  return cards
}

export function pwmEventLabel(e: RunEvent): string {
  return e.kind === 'gate-on' ? 'Comparator → HIGH (r rises above c)' : 'Comparator → LOW (c rises above r)'
}
export function pwmEventWhy(e: RunEvent): string {
  return `At this instant the carrier (${(e.values.carrier ?? 0).toFixed(4)}) and the compared reference (${(e.values.cmp ?? 0).toFixed(4)}) are equal; the gate ${e.kind === 'gate-on' ? 'rises' : 'falls'} and vout becomes ${formatV(e.values.vout ?? 0)}.`
}

const pulseCentre = (r: PwmRun, cycle: number) => (cycle + (r.params.carrier === 'triangle' ? 0 : 0.25)) * r.params.tc + 1e-9

export const PWM_LESSONS: Array<Lesson<PwmParams, PwmRun, PwmMeasurements, PwmState>> = [
  {
    id: 'basics',
    title: 'How a PWM signal is made',
    summary: 'Carrier, reference, comparator — and why the average equals D·Vdc.',
    check: {
      question: 'A DC reference sets the duty ratio to 30 %. The average of the 0…Vdc pulse train is…',
      options: ['0.3·Vdc', '0.7·Vdc', 'Vdc/2'],
      answer: 0,
      explain: 'The output is Vdc for D·Tc and 0 for the rest of each carrier period: its average is D·Vdc.',
    },
    base: { reference: 'dc', duty: 0.3, output: 'unipolar', periods: 4 },
    steps: [
      {
        title: 'A carrier and a reference meet in a comparator',
        at: (r) => pulseCentre(r, 1) + 0.05 * r.params.tc,
        channels: ['carrier', 'cmp', 'gate'],
        look: 'The gate is HIGH while the reference is above the triangle.',
        body: (st, _m, r) => `The triangle carrier sweeps from −1 to +1 every Tc = ${formatTime(r.params.tc)}. The reference is constant here, r = ${st.cmp.toFixed(3)}. Right now c = ${st.carrier.toFixed(3)} is ${st.gate ? 'below' : 'above'} r, so the gate is ${st.gate ? 'HIGH' : 'LOW'}.`,
      },
      {
        title: 'The duty ratio is (1 + r)/2',
        at: (r) => pulseCentre(r, 1),
        channels: ['carrier', 'cmp', 'gate', 'vout'],
        look: 'Each pulse is HIGH for 30 % of the carrier period.',
        body: (st) => `The carrier stays below r for a fraction (1 + r)/2 of every period: D = (1 + ${st.cmp.toFixed(2)})/2 = ${(((1 + st.cmp) / 2) * 100).toFixed(1)} %. SIMULATION: this period's pulse lasts ${(st.localDuty * 100).toFixed(2)} % of Tc.`,
      },
      {
        title: 'The average is D·Vdc',
        params: {},
        at: (r) => pulseCentre(r, 2),
        channels: ['vout', 'vavg'],
        look: 'vavg — the average over the last carrier period — is a flat line at D·Vdc.',
        body: (st, m, r) => `vout jumps between 0 and ${formatV(r.params.vdc, false)}, but its average over each carrier period is ${formatV(st.vavg)} = D·Vdc = ${formatV(r.params.duty * r.params.vdc, false)}. SIMULATION over the whole run: ${formatV(m.avg, false)}.`,
      },
      {
        title: 'What the pulses add: harmonics of fc',
        at: (r) => pulseCentre(r, 2),
        channels: ['vout', 'vavg'],
        look: 'Open Analyze → Spectrum: components at fc, 2fc, 3fc …',
        body: (_st, m, r) => `Besides the average, the pulse train contains components at fc = ${formatSI(r.params.fcEff, 'Hz')} and its multiples: SIMULATION ${formatV(m.at[1] ?? 0, false)} at fc, ${formatV(m.at[2] ?? 0, false)} at 2fc. THEORY: (2·Vdc/(h·π))·|sin(h·π·D)|. A filter or an inductive load keeps the average and rejects these.`,
      },
    ],
  },
  {
    id: 'spwm',
    title: 'Sine-triangle PWM',
    summary: 'A sine reference: the pulse widths follow it, and the fundamental is M·Vdc/2.',
    check: {
      question: 'In the linear range (M ≤ 1), halving the modulation index M makes the fundamental…',
      options: ['halve', 'stay the same', 'drop to a quarter'],
      answer: 0,
      explain: 'The local average of the pulses follows the reference, so the fundamental is M·Vdc/2: proportional to M.',
    },
    base: { reference: 'sine', m: 0.8, mf: 15, sampling: 'natural', output: 'bipolar', periods: 1 },
    steps: [
      {
        title: 'The pulse widths follow the sine',
        at: (r) => r.params.period / 4,
        window: (r) => [0, r.params.period],
        channels: ['carrier', 'ref', 'gate'],
        look: 'Near the sine peak the pulses are wide; near the trough they are narrow.',
        body: (st) => `At the positive peak the reference is r = ${st.ref.toFixed(3)}, so the gate is HIGH for (1 + r)/2 = ${(((1 + st.ref) / 2) * 100).toFixed(1)} % of the carrier period (SIMULATION here: ${(st.localDuty * 100).toFixed(1)} %).`,
      },
      {
        title: 'The local average reproduces the sine',
        at: (r) => r.params.period / 4,
        window: (r) => [0, r.params.period],
        channels: ['vout', 'vavg', 'ref'],
        look: 'vavg traces a sine of amplitude M·Vdc/2.',
        body: (_st, m, r) => `Averaged over each carrier period, the ±${formatV(r.params.vdc / 2, false)} pulses give a sine: fundamental SIMULATION ${formatV(m.v1, false)} peak, THEORY M·Vdc/2 = ${formatV((r.params.m * r.params.vdc) / 2, false)}.`,
      },
      {
        title: 'The spectrum: fundamental plus carrier groups',
        at: (r) => r.params.period / 4,
        window: (r) => [0, r.params.period],
        channels: ['vout', 'vavg'],
        look: 'Analyze → Spectrum: clusters at mf and 2·mf.',
        body: (_st, m, r) => `Natural sampling puts no harmonics between the fundamental and the first carrier group: the 3rd is ${formatV(m.at[3] ?? 0, false)}. The group around mf = ${r.params.mf} carries ${formatV(m.at[r.params.mf] ?? 0, false)} at h = mf. These amplitudes follow Bessel functions J_n(m·π·M/2) — the Analyze table compares them.`,
      },
      {
        title: 'Regular sampling: what a digital controller does',
        params: { sampling: 'regular-sym' },
        at: (r) => r.params.period / 4,
        window: (r) => [0, r.params.period],
        channels: ['ref', 'cmp', 'gate'],
        look: 'The compared reference is a staircase: one sample per carrier period.',
        body: (_st, m) => `The reference is sampled at each carrier peak and held. The fundamental shrinks slightly (SIMULATION ${formatV(m.v1, false)}) and small low-order harmonics appear: the 3rd is now ${formatV(m.at[3] ?? 0, false)}.`,
      },
    ],
  },
]

export const PWM_EXPERIMENTS: Array<Experiment<PwmParams, PwmMeasurements>> = [
  {
    id: 'mf',
    title: 'Double the carrier frequency (mf)',
    change: (p) => ({ reference: 'sine', mf: Math.min(99, p.mf * 2 + (p.mf % 2 === 0 ? 1 : 0)) }),
    question: (p) => `mf goes from ${p.mf} to about ${Math.min(99, p.mf * 2)}. What happens to the first group of switching harmonics?`,
    choices: ['It moves to a higher order (further from the fundamental)', 'It moves closer to the fundamental', 'It stays where it is'],
    judge: (b, a) => (a.firstSignificant > b.firstSignificant * 1.5 ? 0 : a.firstSignificant < b.firstSignificant / 1.5 ? 1 : 2),
    rows: ['v1', 'firstSignificant', 'thd', 'pulses'],
    why: (b, a) => `The first significant harmonic moved from h = ${b.firstSignificant} to h = ${a.firstSignificant}: the switching components cluster around the carrier frequency, and the carrier is now twice as fast. The fundamental did not change (${formatV(b.v1, false)} → ${formatV(a.v1, false)}): it is set by M, not by mf.`,
  },
  {
    id: 'm',
    title: 'Halve the modulation index',
    change: (p) => ({ reference: 'sine', m: p.m / 2 }),
    question: (p) => `M goes from ${p.m.toFixed(2)} to ${(p.m / 2).toFixed(2)}. What happens to the fundamental V1?`,
    choices: ['V1 halves', 'V1 stays the same', 'V1 doubles'],
    judge: (b, a) => {
      const q = a.v1 / b.v1
      return Math.abs(q - 0.5) < 0.05 ? 0 : Math.abs(q - 1) < 0.05 ? 1 : 2
    },
    rows: ['v1', 'thd', 'rms'],
    why: (b, a) => `V1: ${formatV(b.v1, false)} → ${formatV(a.v1, false)} (×${(a.v1 / b.v1).toFixed(3)}). In the linear range V1 = M·Vdc/2. The RMS of a two-level waveform is always Vdc/2 (${formatV(a.rms, false)}), so a smaller fundamental means more of that RMS is harmonics: THD ${(b.thd * 100).toFixed(1)} % → ${(a.thd * 100).toFixed(1)} %.`,
  },
  {
    id: 'overmod',
    title: 'Overmodulate (M > 1)',
    change: () => ({ reference: 'sine', m: 1.3 }),
    question: (p) => `M goes from ${p.m.toFixed(2)} to 1.30. Does V1 grow in proportion (×${(1.3 / p.m).toFixed(2)})?`,
    choices: ['Less than in proportion — pulses drop', 'Exactly in proportion', 'More than in proportion'],
    judge: (b, a) => {
      const q = a.v1 / b.v1
      return q < 0.98 * (1.3 / 0.8) ? 0 : q < 1.02 * (1.3 / 0.8) ? 1 : 2
    },
    rows: ['v1', 'dropped', 'pulses', 'h3', 'h5'],
    why: (b, a) => `V1 went ${formatV(b.v1, false)} → ${formatV(a.v1, false)} (×${(a.v1 / b.v1).toFixed(3)}). Near the sine peaks the reference stays above the whole carrier: ${a.dropped} carrier periods have no switching at all (pulse dropping). The output saturates, the fundamental grows less than M, and low-order harmonics appear (3rd: ${formatV(a.h3, false)}, 5th: ${formatV(a.h5, false)}).`,
  },
  {
    id: 'sampling',
    title: 'Natural → regular sampling',
    change: () => ({ reference: 'sine', sampling: 'regular-sym' }),
    question: () => 'The reference is sampled once per carrier period instead of compared continuously. What appears in the spectrum?',
    choices: ['Small low-order harmonics (3rd, 5th …)', 'Nothing changes', 'The fundamental disappears'],
    judge: (b, a) => (a.h3 > Math.max(10 * b.h3, 1e-4) ? 0 : Math.abs(a.v1 - b.v1) < 1e-6 ? 1 : 2),
    rows: ['v1', 'h3', 'h5', 'thd'],
    why: (b, a) => `3rd harmonic: ${formatV(b.h3, false)} → ${formatV(a.h3, false)}. The held sample lags the true reference and is constant inside each period; that distortion shows up as baseband harmonics and a slightly smaller fundamental (${formatV(b.v1, false)} → ${formatV(a.v1, false)}). A higher mf makes both effects smaller.`,
  },
]

export function pwmPredictions(seed: number): Array<PredictTask<PwmParams, PwmMeasurements>> {
  const r1 = ((seed * 9301 + 49297) % 233280) / 233280
  const M = Math.round((0.3 + 0.6 * r1) * 20) / 20
  const vdc = [100, 200, 400][seed % 3]
  const D = Math.round((0.15 + 0.7 * ((seed * 7) % 10) / 10) * 20) / 20
  const mf = [9, 15, 21][seed % 3]
  return [
    {
      id: 'v1',
      prompt: `Sine-triangle PWM, natural sampling, Vdc = ${vdc} V, M = ${M.toFixed(2)}. Predict the peak fundamental V1 of the leg voltage.`,
      params: { reference: 'sine', m: M, vdc, sampling: 'natural', carrier: 'triangle' },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.v1,
      tolerance: 0.02,
      hint: 'The average over a carrier period is r·Vdc/2.',
      theory: (p) => `V1 = M·Vdc/2 = ${formatV((p.m * p.vdc) / 2, false)}`,
    },
    {
      id: 'avg',
      prompt: `DC reference, unipolar output 0…${vdc} V, D = ${(D * 100).toFixed(0)} %. Predict the average output voltage.`,
      params: { reference: 'dc', duty: D, vdc, output: 'unipolar' },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.avg,
      tolerance: 0.02,
      hint: 'The output is Vdc for D·Tc and 0 otherwise.',
      theory: (p) => `Vavg = D·Vdc = ${formatV(p.duty * p.vdc, false)}`,
    },
    {
      id: 'cluster',
      prompt: `Sine-triangle PWM with mf = ${mf}, M = 0.8. Where is the largest component after the fundamental?`,
      params: { reference: 'sine', mf, m: 0.8, sampling: 'natural', carrier: 'triangle' },
      kind: 'choice',
      choices: ['At the 3rd harmonic', `At h = ${mf} (the carrier)`, `At h = ${2 * mf}`],
      answer: (m) => {
        let best = 2
        for (const h of m.harmonics) if (h.h >= 2 && h.amp > (m.harmonics[best]?.amp ?? 0)) best = h.h
        return best === 3 ? 0 : best === mf ? 1 : best === 2 * mf ? 2 : 1
      },
      hint: 'Every carrier period makes one pulse.',
      theory: (p) => `Carrier group at h = m·mf ± n; at h = mf the amplitude is (2Vdc/π)·J0(π·M/2) = ${formatV(((2 * p.vdc) / Math.PI) * Math.abs(besselJ0(Math.PI * 0.4)), false)}`,
    },
  ]
}

function besselJ0(x: number) {
  let term = 1
  let sum = 1
  for (let k = 1; k < 40; k++) {
    term *= -(x * x) / (4 * k * k)
    sum += term
  }
  return sum
}
