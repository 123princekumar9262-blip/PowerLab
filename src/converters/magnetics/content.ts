import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { CORE_DEFAULTS, measureCore, simulateCore, type CoreMeasurements, type CoreParams, type CoreRun } from './core.ts'
import { exactCore, textbookCore } from './theory.ts'

export { measureCore, simulateCore }

export interface CoreState {
  k: number
  t: number
  v: number
  i: number
  lam: number
  b: number
  h: number
  vl: number
  region: 'lin' | 'sat+' | 'sat−'
  linc: number
  /** Energy stored in the field ∫i dλ (from λ = 0). */
  w: number
}

export function coreStateAt(r: CoreRun, k: number): CoreState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const region = r.modes[i] as CoreState['region']
  const lam = s.lam[i]
  // ∫ i dλ along the piecewise-linear i(λ): ½·λ²/L1 below λs, plus the saturated part
  const a = Math.min(Math.abs(lam), p.lamS)
  let w = (0.5 * a * a) / p.l1
  if (Math.abs(lam) > p.lamS) {
    const d = Math.abs(lam) - p.lamS
    w += (p.lamS / p.l1) * d + (0.5 * d * d) / p.l2
  }
  return { k: i, t: r.time[i], v: s.v[i], i: s.i[i], lam, b: s.b[i], h: s.h[i], vl: s.vl[i], region, linc: s.linc[i], w }
}

const REGION_TEXT: Record<CoreState['region'], string> = { lin: 'linear (unsaturated)', 'sat+': 'saturated (+)', 'sat−': 'saturated (−)' }

export function coreView(st: CoreState, r: CoreRun): StateView {
  const p = r.params
  return {
    badge: { text: REGION_TEXT[st.region], tone: st.region === 'lin' ? 'on' : 'off' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'applied voltage', v: formatV(st.v) },
      { k: 'current', v: formatA(st.i, true) },
      { k: 'flux density B', v: `${st.b.toFixed(4)} T`, tone: Math.abs(st.b) > p.bsat ? 'bad' : 'ok' },
      { k: 'Bsat', v: `${p.bsat} T` },
      { k: 'inductance now', v: formatSI(st.linc, 'H'), full: true, tone: st.region === 'lin' ? 'on-q' : 'bad' },
      { k: 'core field H', v: `${st.h.toFixed(0)} A/m`, min: 'standard' },
      { k: 'flux linkage λ', v: formatSI(st.lam, 'Wb'), min: 'standard' },
      { k: 'voltage on L', v: formatV(st.vl), min: 'standard' },
      { k: 'stored energy', v: formatSI(st.w, 'J'), min: 'engineer' },
    ],
    path: st.region === 'lin' ? 'flux in the core and the gap — the gap sets the inductance' : 'the core has no more permeability to give: only the gap (and the saturated steel) remains',
  }
}

export function coreWhy(r: CoreRun, st: CoreState, m: CoreMeasurements): WhyCard[] {
  const p = r.params
  const tb = textbookCore(p)
  const cards: WhyCard[] = []
  if (st.region === 'lin')
    cards.push({
      id: 'now',
      question: 'Why does the current ramp linearly?',
      what: `The core is below Bsat (B = ${st.b.toFixed(3)} T): the winding is a constant inductance L = ${formatSI(p.l1, 'H')}.`,
      why: `The voltage ${formatV(st.v)} across it fixes the rate of change of flux: dλ/dt = v − R·i, so the current changes at about v/L = ${formatSI((st.v - p.r * st.i) / p.l1, 'A/s')}.`,
      equation: 'v = R·i + dλ/dt,  λ = L·i',
      physics: `Of the magnetic energy, ${(tb.gapShare * 100).toFixed(0)} % is stored in the ${formatSI(p.lg, 'm')} air gap — the gap, not the steel, sets L.`,
      whatIf: 'More volt-seconds per half-period (lower frequency, higher voltage) push the flux further — towards Bsat.',
    })
  else
    cards.push({
      id: 'now',
      question: 'Why does the current shoot up?',
      what: `The core is saturated: |B| = ${Math.abs(st.b).toFixed(3)} T > Bsat = ${p.bsat} T. The inductance has collapsed to ${formatSI(p.l2, 'H')} (${(p.l1 / p.l2).toFixed(0)}× smaller).`,
      why: 'The steel cannot carry more flux, so each extra volt-second needs a huge extra current — only the gap and the winding resistance limit it.',
      equation: 'di/dt = (v − R·i)/L_sat,  L_sat = N²·μ0·Ae/(lg + le/μsat)',
      physics: `Current now ${formatA(st.i, true)} (peak over the period ${formatA(m.ipk)}). In a converter this spike would destroy the switch or trip its protection.`,
      whatIf: 'More turns, a larger core area or a higher frequency keep the flux swing lower.',
    })
  cards.push({
    id: 'voltsec',
    question: 'What sets the flux swing?',
    what: `SIMULATION: ΔB = ${m.dB.toFixed(3)} T peak-to-peak, Bpk = ${m.bpk.toFixed(3)} T.`,
    why: 'Faraday: the flux changes by the volt-seconds applied — the inductance does not appear. A voltage-driven core cannot be protected by changing the gap.',
    equation: `ΔB = V·d·T/(N·Ae) = ${tb.dB.toFixed(3)} T`,
    physics: m.saturated ? 'Here the core saturates for part of the period, so the flux swing is clipped near ±Bsat and the current pays for it.' : `The peak stays ${((1 - m.bpk / p.bsat) * 100).toFixed(0)} % below Bsat.`,
    whatIf: 'Doubling N halves ΔB (and quadruples L); halving f doubles ΔB.',
  })
  cards.push({
    id: 'dc',
    question: 'Why does a small duty error matter?',
    what: `SIMULATION: mean current ${formatA(m.idc, true)} at d = ${(p.duty * 100).toFixed(1)} %.`,
    why: 'In steady state the inductor\'s mean voltage must be zero, so the whole mean applied voltage (2d − 1)·V falls on the winding resistance: the DC current is limited only by R.',
    equation: `Idc = (2d − 1)·V/R = ${formatA(tb.idc, true)}`,
    physics: 'That DC current shifts the flux by L·Idc/(N·Ae) — a few percent of duty imbalance can push a transformer into saturation.',
    whatIf: 'A series (DC-blocking) capacitor or current-mode control removes the imbalance.',
  })
  if (p.view === 'startup')
    cards.push({
      id: 'inrush',
      question: 'Why is the start-up current so much larger?',
      what: `SIMULATION: the current reaches ${formatA(m.iPeakRun)} during start-up${m.tSat !== null ? `, saturating at ${formatTime(m.tSat)}` : ''}, versus ${formatA(m.ipk)} in steady state.`,
      why: 'In steady state the flux swings symmetrically, ±ΔB/2. Starting from zero flux, the first +V interval drives it the full ΔB in one direction — twice the steady-state peak (the same effect as transformer inrush).',
      equation: `B after the first half-period ≈ V·d·T/(N·Ae) = ${tb.bFirst.toFixed(3)} T`,
      physics: `The offset decays with the time constant L/R = ${formatTime(p.tau1)}, so it takes many periods to settle.`,
      whatIf: 'Starting with a half-width first pulse places the flux at −ΔB/2 at once: no offset, no inrush.',
    })
  return cards
}

export function compareCore(r: CoreRun, m: CoreMeasurements): CompareResult {
  const p = r.params
  const ex = exactCore(p)
  const tb = textbookCore(p)
  const rows: CompareRow[] = []
  const satNa = tb.saturates || m.saturated ? 'the core saturates: the linear-inductor formula does not apply' : undefined
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tbv: number | null, formula: string, notes: string[], opts: { scale?: number; na?: string } = {}) => {
    if (sim === null || exact === null) return
    const den = opts.scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const textbook: TextbookValue | null = tbv === null && !opts.na ? null : { key, value: opts.na ? null : tbv, formula, assumptions: notes, notApplicable: opts.na }
    rows.push({ key, label, unit, sim, exact, error, tolerance: 0.005, pass: error <= 0.005, absolute: opts.scale !== undefined, textbook, textbookError: textbook?.value != null ? (sim - textbook.value) / Math.max(Math.abs(textbook.value), 1e-30) : null })
  }
  add('dB', 'Flux swing ΔB', 'T', m.dB, ex.dB, tb.dB, 'V·d·T/(N·Ae)', ['the R·i drop is neglected'], { na: m.saturated ? 'the swing is clipped by saturation' : undefined })
  add('bpk', 'Peak flux density', 'T', m.bpk, ex.bpk, tb.bpk, 'L·|Idc|/(N·Ae) + ΔB/2', ['linear core'], { na: satNa })
  add('ipk', 'Peak current', 'A', m.ipk, ex.ipk, tb.ipk, '|Idc| + V·d·T/(2·L)', ['linear core'], { na: satNa })
  add('idc', 'Mean current', 'A', m.idc, ex.idc, p.view === 'steady' ? tb.idc : null, '(2d − 1)·V/R', ['exact in the periodic steady state: the inductor\'s mean voltage is zero'], { scale: Math.max(m.ipk, 1e-6) })
  add('sat', 'Time saturated (fraction of the period)', '%', m.satFrac, ex.satFrac, null, '', [], { scale: 1 })
  if (p.view === 'startup') {
    add('inrush', 'Peak start-up current', 'A', m.iPeakRun, ex.iPeakRun, null, '', [])
    if (m.tSat !== null || ex.tSat !== null) add('tsat', 'First saturation', 's', m.tSat, ex.tSat, tb.tSat, 'N·Ae·Bsat/V', ['R neglected: the flux rises at exactly V/N'])
  }
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `SIMULATION: trapezoidal time-stepping of the winding with every entry into saturation located exactly. THEORY: the exact piecewise-linear solution (matrix exponential)${p.view === 'steady' ? ' and its periodic steady state' : ''}. Textbook: the linear inductor and volt-second balance.`,
    note: 'Core losses (hysteresis, eddy currents) are not modelled: the only loss is the winding resistance.',
  }
}

export function coreEventLabel(e: RunEvent): string {
  if (e.kind === 'gate-on') return 'Bridge applies +V'
  if (e.kind === 'gate-off') return 'Bridge applies −V'
  const to = (e.device ?? '').split('→')[1]
  if (to === 'sat+' || to === 'sat−') return 'The core saturates'
  if (to === 'lin') return 'The core leaves saturation'
  return e.device ?? e.kind
}
export function coreEventWhy(e: RunEvent): string {
  return `i = ${formatA(e.values.i ?? 0, true)}, B = ${(e.values.b ?? 0).toFixed(3)} T, v = ${formatV(e.values.v ?? 0)}. ${coreEventLabel(e) === 'The core saturates' ? 'The flux reached Bsat: the inductance collapses and the current rises steeply.' : 'The B–H curve changes slope here, so the winding equation changes.'}`
}

type L = Lesson<CoreParams, CoreRun, CoreMeasurements, CoreState>

export const CORE_LESSONS: L[] = [
  {
    id: 'voltsec',
    title: 'Volt-seconds set the flux',
    summary: 'A square wave across a winding: the flux is a triangle, and the gap sets the current.',
    base: { view: 'steady', duty: 0.5 },
    steps: [
      {
        title: '1 · A triangle of flux',
        params: { lg: 0.5e-3 },
        at: (r) => 0.5 * r.params.duty * r.params.period,
        channels: ['v', 'b', 'i'],
        look: 'While +V is applied B rises at a constant rate; while −V is applied it falls.',
        body: (_st, m, r) => `B swings ${m.dB.toFixed(3)} T peak-to-peak = V·d·T/(N·Ae) — set only by the volt-seconds, the turns and the core area. The current follows with L = ${formatSI(r.params.l1, 'H')}: ${formatA(m.ipk)} peak.`,
      },
      {
        title: '2 · Close the gap',
        params: { lg: 0 },
        at: (r) => 0.5 * r.params.duty * r.params.period,
        channels: ['v', 'b', 'i'],
        look: 'The same flux triangle — but the current is tiny.',
        body: (_st, m, r) => `Without a gap L = ${formatSI(r.params.l1, 'H')}: the flux swing is the same ${m.dB.toFixed(3)} T, but the current is only ${formatA(m.ipk)}. Under voltage drive the gap changes the current, not the flux.`,
      },
    ],
  },
  {
    id: 'inrush',
    title: 'Start-up flux doubling',
    summary: 'Switch the bridge on at zero flux — and watch the core saturate in the first period.',
    base: { view: 'startup', duty: 0.5 },
    steps: [
      {
        title: '1 · The first half-period',
        at: (r) => (measureCore(r).tSat ?? 0.5 * r.params.period) - 0.05 * r.params.period,
        window: (r) => [0, 4 * r.params.period],
        channels: ['v', 'b', 'i'],
        look: 'B starts at zero and rises for the whole first +V interval — heading for twice the steady peak.',
        body: (st, _m, r) => `B = ${st.b.toFixed(3)} T and still rising: starting from zero, the first +V interval moves the flux by the full V·d·T/(N·Ae) in one direction. Bsat = ${r.params.bsat} T is in the way.`,
      },
      {
        title: '2 · Saturation: the inrush spike',
        at: (r) => (measureCore(r).tSat ?? 0) + 0.02 * r.params.period,
        window: (r) => [0, 4 * r.params.period],
        channels: ['b', 'i', 'linc'],
        look: 'The inductance collapses; the current spikes.',
        body: (st, m) => `Saturated: the current is ${formatA(st.i, true)} and peaks at ${formatA(m.iPeakRun)} — compared with ${formatA(m.ipk)} once settled.`,
      },
      {
        title: '3 · The offset decays',
        at: (r) => 0.5 * r.params.duration,
        window: (r) => [0, r.params.duration],
        channels: ['b', 'i'],
        look: 'The flux offset (and the current spikes) die away with the time constant L/R.',
        body: (_st, _m, r) => `The winding resistance slowly removes the DC offset: τ = L/R = ${formatTime(r.params.tau1)} (${(r.params.tau1 / r.params.period).toFixed(0)} periods). A transformer energised at the wrong instant shows the same inrush.`,
      },
    ],
  },
  {
    id: 'dcbias',
    title: 'A small DC bias saturates the core',
    summary: 'Change the duty by 2 % — the DC current walks the flux into saturation.',
    base: { view: 'steady' },
    steps: [
      {
        title: '1 · Balanced: d = 50 %',
        params: { duty: 0.5 },
        at: (r) => r.params.duty * r.params.period,
        channels: ['v', 'b', 'i'],
        look: 'B swings symmetrically around zero.',
        body: (_st, m) => `Mean current ${formatA(m.idc, true)}, Bpk ${m.bpk.toFixed(3)} T.`,
      },
      {
        title: '2 · Unbalanced: d = 52 %',
        params: { duty: 0.52 },
        at: (r) => r.params.duty * r.params.period - 0.01 * r.params.period,
        channels: ['v', 'b', 'i'],
        look: 'The flux sits higher; at its top the core saturates and the current spikes.',
        body: (_st, m, r) => `The 4 % mean voltage, (2d − 1)·V = ${formatV((2 * r.params.duty - 1) * r.params.vdc)}, drives Idc = ${formatA(m.idc, true)} through R = ${formatSI(r.params.r, 'Ω')}. The flux shifts up, the core is saturated ${(m.satFrac * 100).toFixed(1)} % of the time and the peak current is ${formatA(m.ipk)}.`,
      },
    ],
  },
]

export const CORE_EXPERIMENTS: Array<Experiment<CoreParams, CoreMeasurements>> = [
  {
    id: 'gap',
    title: 'Double the air gap',
    change: (p) => ({ lg: Math.max(0.25e-3, p.lg * 2) }),
    question: () => 'The air gap doubles. What happens to the flux swing ΔB?',
    choices: ['It stays the same — the current rises instead', 'It halves', 'It doubles'],
    judge: (b, a) => (Math.abs(a.dB / b.dB - 1) < 0.05 ? 0 : a.dB < b.dB ? 1 : 2),
    rows: ['dB', 'ipk', 'lMeas'],
    why: (b, a) => `ΔB ${b.dB.toFixed(3)} → ${a.dB.toFixed(3)} T, peak current ${formatA(b.ipk)} → ${formatA(a.ipk)}, L ${formatSI(b.lMeas, 'H')} → ${formatSI(a.lMeas, 'H')}. The volt-seconds fix the flux; a larger gap lowers L, so more current is needed for the same flux.`,
  },
  {
    id: 'freq',
    title: 'Lower the frequency to 60 %',
    change: (p) => ({ f: p.f * 0.6 }),
    question: () => 'The switching frequency drops to 60 %. What happens?',
    choices: ['The flux swing grows and the core saturates', 'The flux swing shrinks', 'Nothing changes'],
    judge: (b, a) => (a.saturated && a.ipk > 2 * b.ipk ? 0 : a.dB < b.dB ? 1 : 2),
    rows: ['bpk', 'ipk', 'satFrac'],
    why: (b, a) => `Bpk ${b.bpk.toFixed(3)} → ${a.bpk.toFixed(3)} T, peak current ${formatA(b.ipk)} → ${formatA(a.ipk)}. Each half-period lasts longer, so more volt-seconds reach the core; past Bsat the inductance collapses. This is why a magnetic component is designed for a minimum frequency.`,
  },
  {
    id: 'turns',
    title: 'Double the turns',
    change: (p) => ({ n: p.n * 2 }),
    question: () => 'The number of turns doubles. What happens to the peak flux density?',
    choices: ['It halves', 'It doubles', 'It stays the same'],
    judge: (b, a) => (Math.abs(a.bpk / b.bpk - 0.5) < 0.05 ? 0 : a.bpk > b.bpk ? 1 : 2),
    rows: ['bpk', 'ipk', 'lMeas'],
    why: (b, a) => `Bpk ${b.bpk.toFixed(3)} → ${a.bpk.toFixed(3)} T, L ${formatSI(b.lMeas, 'H')} → ${formatSI(a.lMeas, 'H')}. Each volt is now shared by twice the turns (B ∝ V/N), and L grows with N²: the current drops to a quarter.`,
  },
  {
    id: 'duty',
    title: 'Unbalance the duty by 3 %',
    change: (p) => ({ duty: Math.min(0.7, p.duty + 0.03) }),
    question: () => 'The duty becomes 3 % larger than 50 %. What happens?',
    choices: ['A DC current builds up and drives the core into saturation', 'Only the flux swing changes a little', 'The current reverses'],
    judge: (b, a) => (a.saturated && Math.abs(a.idc) > 5 * Math.abs(b.idc) + 1 ? 0 : 1),
    rows: ['idc', 'bpk', 'ipk'],
    why: (b, a, _p0, p1) => `Mean current ${formatA(b.idc, true)} → ${formatA(a.idc, true)} = (2d − 1)·V/R with R only ${formatSI(p1.r, 'Ω')}. The DC flux it creates adds to the swing: Bpk ${b.bpk.toFixed(3)} → ${a.bpk.toFixed(3)} T, peak current ${formatA(b.ipk)} → ${formatA(a.ipk)}.`,
  },
]

export function corePredictions(seed: number): Array<PredictTask<CoreParams, CoreMeasurements>> {
  const lg = [0.25e-3, 0.5e-3, 1e-3][seed % 3]
  const f = [20e3, 30e3, 40e3][(seed + 1) % 3]
  return [
    {
      id: 'L',
      prompt: `N = 20 turns, Ae = 50 mm², le = 50 mm, μr = 2000, air gap ${lg * 1e3} mm. Predict the inductance.`,
      params: { lg, view: 'steady', f: 40e3 },
      kind: 'number',
      unit: 'H',
      answer: (m) => m.lMeas,
      tolerance: 0.03,
      hint: 'L = N²·μ0·Ae/(lg + le/μr) — the gap usually dominates.',
      theory: (p) => `L = N²·μ0·Ae/(lg + le/μr) = ${formatSI((p.n * p.n * 4e-7 * Math.PI * p.ae) / (p.lg + p.le / p.mur), 'H')}`,
    },
    {
      id: 'dB',
      prompt: `±24 V square wave at ${f / 1e3} kHz, N = 20, Ae = 50 mm². Predict the peak-to-peak flux swing.`,
      params: { f, view: 'steady' },
      kind: 'number',
      unit: 'T',
      answer: (m) => m.dB,
      tolerance: 0.03,
      hint: 'ΔB = V·(T/2)/(N·Ae).',
      theory: (p) => `ΔB = V·d/(f·N·Ae) = ${((p.vdc * p.duty) / (p.f * p.n * p.ae)).toFixed(3)} T`,
    },
  ]
}

export { CORE_DEFAULTS, formatW }
