import type { Experiment, Lesson, PredictTask, Reading, StateView, StatusInfo, WhyCard } from '../../lab/types.ts'
import { formatSI, formatTime, formatV } from '../../utils/format.ts'
import { nextRunEvent } from '../cursor.ts'
import type { RunEvent } from '../types.ts'
import type { MultiMeasurements } from './multipulseAnalysis.ts'
import { carrierMag, halfSign, MULTI_DEFAULTS, type MultiPulseParams, type MultiPulseRun } from './multipulse.ts'

/** The modulator and the bridge at one instant — read from the simulated run. */
export interface MultiState {
  k: number
  t: number
  /** Angle in the fundamental cycle [deg]. */
  theta: number
  carrier: number
  ref: number
  gate: boolean
  /** Leg commands after steering: leg A up (S1), leg B up (S3). */
  gA: boolean
  gB: boolean
  vout: number
  v1: number
  vavg: number
  /** +1 in the positive half cycle, −1 in the negative one. */
  sign: 1 | -1
  /** Carrier period inside the present half cycle (1 … p). */
  slot: number
  /** The pulse containing the cursor (or the next one in this half cycle): start and end [s]. */
  pulse: { start: number; end: number } | null
  /** Time of the next comparator edge. */
  nextEdge: number | null
}

export function multiStateAt(r: MultiPulseRun, k: number): MultiState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const t = r.time[i]
  const s = r.signals
  const T = p.period
  const tm = i === 0 ? 1e-15 * T : t - p.dt / 2
  const sign = halfSign(p, tm)
  const u = tm / T - Math.floor(tm / T)
  const slot = Math.min(p.p, Math.floor((u % 0.5) * 2 * p.p) + 1)
  // pulse around the cursor, from the simulated segments (periodic)
  const base = Math.floor(tm / T) * T
  // the pulse containing the cursor, else the next one (the simulated segments, periodic; ordered in time)
  let pulse: MultiState['pulse'] = null
  for (const c of [base, base + T]) {
    const seg = r.segs.find((x) => x.va !== 0 && c + x.tb > tm)
    if (seg) {
      pulse = { start: c + seg.ta, end: c + seg.tb }
      break
    }
  }
  let nextEdge: number | null = null
  for (const c of [base, base + T]) {
    for (const e of r.edges) if (c + e.t > tm && (nextEdge === null || c + e.t < nextEdge)) nextEdge = c + e.t
    if (nextEdge !== null) break
  }
  return {
    k: i,
    t,
    theta: u * 360,
    carrier: sign * carrierMag(p, tm),
    ref: sign * p.m,
    gate: s.gate[i] > 0.5,
    gA: s.gA[i] > 0.5,
    gB: s.gB[i] > 0.5,
    vout: s.vout[i],
    v1: s.v1[i],
    vavg: s.vavg[i],
    sign,
    slot,
    pulse,
    nextEdge,
  }
}

const deg = (x: number) => `${x.toFixed(1)}°`

export function multiView(st: MultiState, r: MultiPulseRun): StateView {
  const p = r.params
  const pos = st.sign > 0
  return {
    badge: { text: st.gate ? `Pulse: vAB = ${pos ? '+' : '−'}Vdc` : 'Between pulses: vAB = 0', tone: st.gate ? 'on' : 'off' },
    rows: [
      { k: 't', v: `${formatTime(st.t)} · θ = ${deg(st.theta)}`, full: true },
      { k: 'half cycle', v: `${pos ? 'positive' : 'negative'} · carrier period ${st.slot} of ${p.p}`, full: true },
      { k: 'reference |r|', v: p.m.toFixed(3) },
      { k: 'carrier |c|', v: Math.abs(st.carrier).toFixed(3) },
      { k: 'comparator', v: st.gate ? '|r| > |c| → HIGH' : '|r| < |c| → LOW', tone: st.gate ? 'on-q' : 'off', full: true },
      { k: 'vAB', v: formatV(st.vout) },
      { k: 'fundamental', v: formatV(st.v1), min: 'standard' },
      { k: 'local average', v: formatV(st.vavg), min: 'standard' },
      { k: 'leg A', v: st.gA ? 'S1 ON (upper)' : 'S2 ON (lower)', tone: st.gA ? 'on-q' : 'off', min: 'engineer' },
      { k: 'leg B', v: st.gB ? 'S3 ON (upper)' : 'S4 ON (lower)', tone: st.gB ? 'on-q' : 'off', min: 'engineer' },
      { k: 'next edge', v: st.nextEdge !== null ? formatTime(st.nextEdge) : '—', min: 'engineer' },
    ],
    path: st.gate ? (pos ? 'S1 and S4 connect the load to +Vdc' : 'S3 and S2 connect the load to −Vdc') : pos ? 'S2 and S4 short the load: vAB = 0' : 'S2 and S4 short the load: vAB = 0',
  }
}

export function multiStatus(st: MultiState, r: MultiPulseRun): StatusInfo {
  const p = r.params
  const half = st.sign > 0 ? 'positive half' : 'negative half'
  return st.gate
    ? { headline: `Pulse ${st.slot} of ${p.p} · vAB = ${formatV(st.vout)}`, facts: [half, st.sign > 0 ? 'S1 + S4 conduct' : 'S3 + S2 conduct', `|r| = ${p.m.toFixed(2)} above the carrier`], tone: 'on' }
    : { headline: 'Between pulses · vAB = 0', facts: [half, 'S2 + S4 short the load', 'carrier above |r|'], tone: 'off' }
}

export function multiWhy(r: MultiPulseRun, st: MultiState, m: MultiMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const deltaDeg = (p.m * 180) / p.p
  cards.push({
    id: 'gate',
    question: st.gate ? `Why is there a ${st.sign > 0 ? 'positive' : 'negative'} pulse now?` : 'Why is the output zero now?',
    what: `The comparator sees |r| = ${p.m.toFixed(3)} and the carrier |c| = ${Math.abs(st.carrier).toFixed(3)}.`,
    why: st.gate
      ? `|r| is above the carrier, so the comparator is HIGH. It is the ${st.sign > 0 ? 'positive' : 'negative'} half cycle, so the steering sends the pulse to leg ${st.sign > 0 ? 'A (S1 and S4 conduct: vAB = +Vdc)' : 'B (S3 and S2 conduct: vAB = −Vdc)'}.`
      : 'The carrier has risen above |r|: the comparator is LOW and both legs sit on the lower rail (S2 and S4), so the load is shorted: vAB = 0.',
    equation: `g = (|r| > |c|) = (${p.m.toFixed(3)} ${st.gate ? '>' : '<'} ${Math.abs(st.carrier).toFixed(3)})`,
    physics: 'Uniform multiple-pulse modulation: the reference is a square wave, so every pulse in the cycle has the same width. Only the polarity changes from one half cycle to the next.',
    whatIf: `Raising M widens every pulse at once; at M = 1 neighbouring pulses touch and the output becomes a square wave.`,
  })
  cards.push({
    id: 'width',
    question: 'Why is each pulse this wide?',
    what: `Each pulse lasts ${deg(m.deltaDeg)} of the cycle (SIMULATION, measured from the edges); there are ${m.pulses} per half cycle.`,
    why: `The carrier runs at 2p·f1 = ${formatSI(p.fc, 'Hz')}, so one carrier period spans 180°/p = ${deg(180 / p.p)}. The 0…1 triangle stays below M for a fraction M of that: δ = M·180°/p = ${deg(deltaDeg)}.`,
    equation: `δ = M·π/p = ${p.m.toFixed(2)}·180°/${p.p} = ${deg(deltaDeg)}`,
    physics: `The pulses always add up to p·δ = M·180° per half cycle, whatever p is. That is why the RMS, Vdc·√(p·δ/π) = Vdc·√M = ${formatV(m.rms, false)}, depends on M only.`,
    whatIf: `With p = ${Math.min(15, p.p + 1)} each pulse would be ${deg((p.m * 180) / Math.min(15, p.p + 1))} wide: more, narrower pulses with the same total width.`,
  })
  cards.push({
    id: 'fund',
    question: 'Why is the fundamental this size?',
    what: `The fundamental is ${formatV(m.v1, false)} peak (SIMULATION, exact Fourier integral of the pulses).`,
    why: `Each pulse contributes (4Vdc/π)·sin(δ/2)·sin θk, where θk is its centre. Pulses near 90° count fully, those near 0° and 180° hardly at all, so many narrow pulses give less fundamental than one wide pulse of the same total width.`,
    equation: 'B1 = Σk (4Vdc/π)·sin(δ/2)·sin θk,  θk = (2k − 1)·180°/(2p)',
    physics: `The local average of the pulses is a square wave of height M·Vdc (now ${formatV(st.vavg)}). For many pulses B1 tends to (4/π)·M·Vdc = ${formatV((4 / Math.PI) * p.m * p.vdc, false)}.`,
    whatIf: `A single pulse (p = 1) of width M·180° would give (4Vdc/π)·sin(M·90°) = ${formatV(((4 * p.vdc) / Math.PI) * Math.sin((p.m * Math.PI) / 2), false)}.`,
  })
  cards.push({
    id: 'harm',
    question: p.p >= 2 ? `Why are the largest harmonics near 2p ± 1 = ${2 * p.p - 1}, ${2 * p.p + 1}?` : 'Which harmonics does a single pulse contain?',
    what:
      p.p >= 2
        ? `SIMULATION: B${2 * p.p - 1} = ${formatV(m.at[2 * p.p - 1] ?? 0, false)}, B${2 * p.p + 1} = ${formatV(m.at[2 * p.p + 1] ?? 0, false)}; the largest harmonic is n = ${m.dominant}.`
        : `SIMULATION: B3 = ${formatV(m.h3, false)}, B5 = ${formatV(m.h5, false)}: every odd harmonic, largest at n = ${m.dominant}.`,
    why:
      p.p >= 2
        ? 'The pulses repeat every carrier period, 180°/p. Harmonic n = 2p ± 1 is almost in step with that repetition, so the contributions of all p pulses add up (sin(nπ/2p) in the denominator is small there).'
        : 'One pulse per half cycle with half-wave symmetry: only odd harmonics, Bn = (4Vdc/(nπ))·sin(nδ/2).',
    equation: 'Bn = (4Vdc/(nπ))·sin(nδ/2)/sin(nπ/(2p)),  n odd',
    physics: 'Moving harmonic energy to high orders makes it easy to filter: an inductive load reacts n times more strongly to the n-th harmonic. The low orders (3, 5) do not vanish, though: the local average is still a square wave.',
    whatIf: p.p >= 2 ? `With p = ${Math.min(15, 2 * p.p)} the band would move to n = ${2 * Math.min(15, 2 * p.p) - 1}, ${2 * Math.min(15, 2 * p.p) + 1}.` : 'With p = 5 the largest harmonics would move to n = 9 and 11.',
  })
  return cards
}

export function multiEventLabel(e: RunEvent): string {
  if (e.kind === 'mode') return (e.values.sign ?? 1) > 0 ? 'Positive half cycle begins: pulses steered to leg A' : 'Negative half cycle begins: pulses steered to leg B'
  return e.kind === 'gate-on' ? `Pulse starts (leg ${e.device}): |r| rises above the carrier` : `Pulse ends (leg ${e.device}): the carrier rises above |r|`
}

export function multiEventWhy(e: RunEvent): string {
  if (e.kind === 'mode') return `The square-wave reference changes sign: from now on a HIGH comparator output switches leg ${(e.values.sign ?? 1) > 0 ? 'A up (vAB = +Vdc)' : 'B up (vAB = −Vdc)'}.`
  return `At this instant the carrier (${(e.values.carrier ?? 0).toFixed(4)}) equals |r| = ${(e.values.ref ?? 0).toFixed(4)}; the comparator ${e.kind === 'gate-on' ? 'goes HIGH' : 'goes LOW'} and vAB becomes ${formatV(e.values.vout ?? 0)}.`
}

/** What happens next: the run's next comparator edge or half-cycle change. */
export function multiNext(r: MultiPulseRun, st: MultiState): { text: string; time: number | null } {
  const e = nextRunEvent(r, st.k)
  if (!e) return { text: 'This is the end of the shown cycles. The pattern repeats exactly: the next cycle starts with the positive half (pulses on leg A).', time: null }
  const at = `t = ${formatTime(e.time)}`
  if (e.kind === 'mode') return { text: `The half cycle ends at ${at}: the reference changes sign and the next pulses are ${(e.values.sign ?? 1) > 0 ? 'positive (leg A)' : 'negative (leg B)'}.`, time: e.time }
  if (e.kind === 'gate-off') return { text: `The carrier rises above |r| at ${at}: this pulse ends and vAB returns to 0.`, time: e.time }
  return { text: `The carrier falls below |r| at ${at}: the next pulse starts, vAB = ${formatV(e.values.vout ?? 0)}.`, time: e.time }
}

/** A value and its unit (with SI prefix) for the readings strip. */
const si = (x: number, unit: string) => {
  const [value, u] = formatSI(x, unit).split(' ')
  return { value, unit: u }
}

export function multiReadings(m: MultiMeasurements, r: MultiPulseRun): Reading[] {
  const p = r.params
  return [
    { id: 'v1', label: 'Fundamental, peak', ...si(m.v1, 'V'), note: 'B1, summed over the p pulses' },
    { id: 'rms', label: 'Output voltage, RMS', ...si(m.rms, 'V'), note: 'Vdc·√(p·δ/π)' },
    { id: 'delta', label: 'Pulse width', value: m.deltaDeg.toFixed(2), unit: '°', note: `δ = M·180°/p, ${m.pulses} per half cycle` },
    { id: 'dominant', label: 'Largest harmonic', value: `n = ${m.dominant}`, unit: '', note: p.p >= 2 ? `near 2p ± 1 = ${2 * p.p - 1}, ${2 * p.p + 1}` : 'single pulse: every odd n', min: 'standard' },
  ]
}

/** The cursor at the middle of the k-th pulse of the positive half cycle (1-based). */
const pulseCentre = (r: MultiPulseRun, k: number) => ((2 * Math.min(k, r.params.p) - 1) / (4 * r.params.p)) * r.params.period + r.params.dt / 2
const cycle = (r: MultiPulseRun): [number, number] => [0, r.params.period]

export const MULTI_LESSONS: Array<Lesson<MultiPulseParams, MultiPulseRun, MultiMeasurements, MultiState>> = [
  {
    id: 'upwm',
    title: 'Equal pulses from a comparator',
    summary: 'A square reference against a fast triangle: p equal pulses in every half cycle.',
    check: {
      question: 'With p = 4 pulses per half cycle and M = 0.6, how wide is each pulse?',
      options: ['27°', '45°', '108°'],
      answer: 0,
      explain: 'One carrier period spans 180°/p = 45°, and the 0…1 triangle stays below M for a fraction M of it: δ = 0.6·45° = 27°.',
    },
    base: { p: 4, m: 0.6, periods: 1 },
    steps: [
      {
        title: 'A square reference meets a fast triangle',
        at: (r) => pulseCentre(r, 2),
        window: cycle,
        channels: ['carrier', 'ref', 'gate'],
        look: 'The carrier makes 2p triangles per cycle; the reference is +M, then −M.',
        body: (st, _m, r) => `The carrier runs at 2p·f1 = ${formatSI(r.params.fc, 'Hz')}: exactly ${r.params.p} triangles fit in each half cycle. The comparator is HIGH while |r| = ${r.params.m.toFixed(2)} is above the carrier. Right now |c| = ${Math.abs(st.carrier).toFixed(3)}, so it is ${st.gate ? 'HIGH' : 'LOW'}.`,
      },
      {
        title: 'Every pulse has the same width',
        at: (r) => pulseCentre(r, 2),
        window: cycle,
        channels: ['carrier', 'ref', 'vout'],
        look: 'p equal pulses per half cycle, centred in each carrier period.',
        body: (_st, m, r) => `SIMULATION: ${m.pulses} pulses per half cycle, each ${m.deltaDeg.toFixed(2)}° wide (narrowest ${m.deltaMinDeg.toFixed(2)}°, widest ${m.deltaMaxDeg.toFixed(2)}°). THEORY: δ = M·180°/p = ${((r.params.m * 180) / r.params.p).toFixed(2)}°.`,
      },
      {
        title: 'Steering: positive pulses, then negative ones',
        at: (r) => r.params.period / 2 + pulseCentre(r, 2),
        window: cycle,
        channels: ['gA', 'gB', 'vout'],
        look: 'Leg A switches in the positive half, leg B in the negative half.',
        body: (st) => `In the positive half S1 and S4 make vAB = +Vdc during each pulse; in the negative half S3 and S2 make −Vdc. Between pulses S2 and S4 short the load (vAB = 0). Now: vAB = ${formatV(st.vout)}.`,
      },
      {
        title: 'The RMS depends on M only',
        at: (r) => pulseCentre(r, 2),
        window: cycle,
        channels: ['vout', 'v1'],
        look: 'The pulses fill p·δ = M·180° of each half cycle.',
        body: (_st, m, r) => `vAB is ±Vdc for p·δ of every half cycle and 0 otherwise, so Vrms = Vdc·√(p·δ/π) = Vdc·√M = ${formatV(r.params.vdc * Math.sqrt(r.params.m), false)}. SIMULATION: ${formatV(m.rms, false)}. The fundamental (dashed) is ${formatV(m.v1, false)} peak.`,
      },
    ],
  },
  {
    id: 'harmonics',
    title: 'One pulse or many: where the harmonics go',
    summary: 'More pulses push the large harmonics up to 2p ± 1, but the 3rd and 5th stay.',
    check: {
      question: 'Uniform PWM with p = 6 pulses per half cycle: near which orders are the largest harmonics?',
      options: ['3 and 5', '11 and 13', '6 and 12'],
      answer: 1,
      explain: 'The pulses repeat every 180°/p, so harmonics n = 2p ± 1 = 11 and 13 add up from all pulses. Even harmonics are absent (half-wave symmetry).',
    },
    base: { p: 1, m: 0.5, periods: 1 },
    steps: [
      {
        title: 'One pulse per half cycle',
        at: (r) => r.params.period / 4,
        window: cycle,
        channels: ['vout', 'v1'],
        look: 'Single-pulse modulation: one block of width M·180° centred on 90°.',
        body: (_st, m) => `With p = 1 the pulse is ${m.deltaDeg.toFixed(1)}° wide. Its spectrum has every odd harmonic: B3 = ${formatV(m.h3, false)} (${(m.h3Ratio * 100).toFixed(1)} % of B1 = ${formatV(m.v1, false)}), B5 = ${formatV(m.h5, false)}. Largest harmonic: n = ${m.dominant}. Open the Spectrum tab.`,
      },
      {
        title: 'Five pulses: a band at 2p ± 1',
        params: { p: 5 },
        at: (r) => pulseCentre(r, 3),
        window: cycle,
        channels: ['vout', 'v1'],
        look: 'Spectrum: the largest bars now sit at n = 9 and 11.',
        body: (_st, m) => `Same M, now ${m.pulses} pulses of ${m.deltaDeg.toFixed(1)}° in each half cycle. The largest harmonic is n = ${m.dominant}; B9 = ${formatV(m.at[9] ?? 0, false)}, B11 = ${formatV(m.at[11] ?? 0, false)}. These high orders are easy to filter.`,
      },
      {
        title: 'The price: less fundamental for the same M',
        params: { p: 5 },
        at: (r) => pulseCentre(r, 3),
        window: cycle,
        channels: ['vout', 'v1', 'vavg'],
        look: 'The local average (over one carrier period) is a square wave of height M·Vdc.',
        body: (_st, m, r) => `The RMS is unchanged (${formatV(m.rms, false)} = Vdc·√M), but the fundamental fell to ${formatV(m.v1, false)}: pulses near 0° and 180° add little to it. Averaged over each carrier period the output is a square wave of height M·Vdc = ${formatV(r.params.m * r.params.vdc, false)}, so B1 tends to (4/π)·M·Vdc = ${formatV((4 / Math.PI) * r.params.m * r.params.vdc, false)}.`,
      },
      {
        title: 'Why the 3rd harmonic stays',
        params: { p: 5 },
        at: (r) => pulseCentre(r, 3),
        window: cycle,
        channels: ['vout', 'vavg'],
        look: 'Spectrum: B3 is still about a third of B1.',
        body: (_st, m) => `SIMULATION: B3/B1 = ${(m.h3Ratio * 100).toFixed(1)} %, B5/B1 = ${((m.h5 / m.v1) * 100).toFixed(1)} %. A square-wave local average carries 1/3 and 1/5 of its fundamental at n = 3 and 5, however many pulses there are. Removing them needs pulse widths that follow a sine: sinusoidal PWM.`,
      },
    ],
  },
]

export const MULTI_EXPERIMENTS: Array<Experiment<MultiPulseParams, MultiMeasurements>> = [
  {
    id: 'p1',
    title: 'From five pulses to one',
    change: () => ({ p: 1 }),
    question: (p) => `p goes from ${p.p} to 1 at the same M = ${p.m}. Where is the largest harmonic now?`,
    choices: ['At n = 3', `At n = ${2 * MULTI_DEFAULTS.p - 1} (still at 2p − 1 of the old p)`, 'There are no harmonics left'],
    judge: (_b, a) => (a.dominant === 3 ? 0 : a.dominant === 2 * MULTI_DEFAULTS.p - 1 ? 1 : 2),
    rows: ['pulses', 'deltaDeg', 'v1', 'dominant', 'h3', 'thd'],
    why: (b, a) => `Largest harmonic: n = ${b.dominant} → n = ${a.dominant}. One wide pulse (${a.deltaDeg.toFixed(1)}°) has the classic single-pulse spectrum, largest at the 3rd (B3 = ${formatV(a.h3, false)}). With ${b.pulses} pulses the big harmonics sat at 2p ± 1. The fundamental rose from ${formatV(b.v1, false)} to ${formatV(a.v1, false)}: one pulse centred on 90° uses the volt-seconds best.`,
  },
  {
    id: 'rms',
    title: 'Double p at the same M',
    change: (p) => ({ p: Math.min(15, p.p * 2) }),
    question: (p) => `p goes from ${p.p} to ${Math.min(15, p.p * 2)} with M = ${p.m}. What happens to the RMS output voltage?`,
    choices: ['It stays the same', 'It doubles', 'It halves'],
    judge: (b, a) => (Math.abs(a.rms / b.rms - 1) < 0.01 ? 0 : a.rms > b.rms ? 1 : 2),
    rows: ['pulses', 'deltaDeg', 'rms', 'v1', 'dominant'],
    why: (b, a) => `RMS ${formatV(b.rms, false)} → ${formatV(a.rms, false)}. Twice as many pulses, each half as wide (${b.deltaDeg.toFixed(2)}° → ${a.deltaDeg.toFixed(2)}°): the total ON angle p·δ = M·180° is unchanged, and so is Vrms = Vdc·√(p·δ/π). The harmonics moved up (largest n = ${b.dominant} → ${a.dominant}).`,
  },
  {
    id: 'm',
    title: 'Halve the modulation index',
    change: (p) => ({ m: p.m / 2 }),
    question: (p) => `M goes from ${p.m} to ${p.m / 2} (p = ${p.p}). What happens to the fundamental?`,
    choices: ['It roughly halves', 'It stays the same', 'It drops to a quarter'],
    judge: (b, a) => {
      const q = a.v1 / b.v1
      return q > 0.4 && q < 0.6 ? 0 : q > 0.9 ? 1 : 2
    },
    rows: ['deltaDeg', 'v1', 'rms', 'thd'],
    why: (b, a) => `B1 ${formatV(b.v1, false)} → ${formatV(a.v1, false)} (×${(a.v1 / b.v1).toFixed(3)}). Each pulse becomes half as wide (${b.deltaDeg.toFixed(1)}° → ${a.deltaDeg.toFixed(1)}°) and sin(δ/2) of a narrow pulse is nearly proportional to δ. The RMS only falls by √2 (${formatV(b.rms, false)} → ${formatV(a.rms, false)}), so the THD rises: ${(b.thd * 100).toFixed(0)} % → ${(a.thd * 100).toFixed(0)} %.`,
  },
]

export function multiPredictions(seed: number): Array<PredictTask<MultiPulseParams, MultiMeasurements>> {
  const p = [3, 4, 5, 6, 8][seed % 5]
  const M = [0.4, 0.5, 0.6, 0.8][seed % 4]
  const vdc = [100, 200, 300][seed % 3]
  const pBand = [4, 6, 7][seed % 3]
  return [
    {
      id: 'delta',
      prompt: `Uniform PWM with p = ${p} pulses per half cycle and M = ${M}. Predict the width of each pulse in degrees.`,
      params: { p, m: M },
      kind: 'number',
      unit: '°',
      answer: (x) => x.deltaDeg,
      tolerance: 0.02,
      hint: 'One carrier period spans 180°/p; the 0…1 triangle is below M for a fraction M of it.',
      theory: (q) => `δ = M·180°/p = ${((q.m * 180) / q.p).toFixed(2)}°`,
    },
    {
      id: 'rms',
      prompt: `Vdc = ${vdc} V, p = ${p}, M = ${M}. Predict the RMS of the output voltage vAB.`,
      params: { p, m: M, vdc },
      kind: 'number',
      unit: 'V',
      answer: (x) => x.rms,
      tolerance: 0.02,
      hint: 'vAB is ±Vdc for p·δ of each half cycle and zero otherwise.',
      theory: (q) => `Vrms = Vdc·√(p·δ/π) = Vdc·√M = ${formatV(q.vdc * Math.sqrt(q.m), false)}`,
    },
    {
      id: 'single',
      prompt: `Single pulse (p = 1), Vdc = ${vdc} V, M = ${M} (pulse width M·180°). Predict the peak fundamental.`,
      params: { p: 1, m: M, vdc },
      kind: 'number',
      unit: 'V',
      answer: (x) => x.v1,
      tolerance: 0.02,
      hint: 'Bn = (4Vdc/(nπ))·sin(nδ/2) for one pulse centred on 90°.',
      theory: (q) => `B1 = (4Vdc/π)·sin(δ/2) = ${formatV(((4 * q.vdc) / Math.PI) * Math.sin((q.m * Math.PI) / 2), false)}`,
    },
    {
      id: 'band',
      prompt: `Uniform PWM with p = ${pBand}, M = 0.5. Which harmonic is the largest after the fundamental?`,
      params: { p: pBand, m: 0.5 },
      kind: 'choice',
      choices: ['n = 3', `n = ${2 * pBand - 1} (2p − 1)`, `n = ${2 * pBand} (2p)`],
      answer: (x) => (x.dominant === 3 ? 0 : x.dominant === 2 * pBand - 1 ? 1 : 2),
      hint: 'The pulses repeat every 180°/p; even harmonics are absent.',
      theory: () => `Bn = (4Vdc/(nπ))·sin(nδ/2)/sin(nπ/(2p)): the denominator is smallest at n = 2p ± 1 = ${2 * pBand - 1}, ${2 * pBand + 1}; even n are zero.`,
    },
  ]
}

