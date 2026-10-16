import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { pMaxMidShunt, pMaxSeries, pvCurve, qAtLimit, qMidShunt, rectifierBridge, solveBus, tanPhi, WEAK0, xTh, type BridgeResult, type PvCurve, type WeakBus } from './calc.ts'

/**
 * What-if experiments: change one thing, predict, then compare the computed before and after. The correct answer is
 * decided from the computation (never written in advance) and every number in an explanation is read from it.
 */

export interface ExpRow {
  label: string
  unit: string
  decimals: number
  before: number
  after: number
}
export interface ExpResult {
  answer: string
  rows: ExpRow[]
  explain: string[]
  beforeLabel?: string
  afterLabel?: string
}
export interface Experiment {
  id: string
  title: string
  /** What the experiment shows (converter level, link, AC power flow or reactive support). */
  layer: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

/** The bridge used by the converter experiments: one 6-pulse bridge, 213 kV valve side, X_c = 12 Ω (illustrative). */
export const EXP_BRIDGE = { vll: 213, xc: 12 }

function bridge(alphaDeg: number, id: number): BridgeResult {
  const b = rectifierBridge(EXP_BRIDGE.vll, alphaDeg, EXP_BRIDGE.xc, id)
  if (!b.ok) throw new Error(`experiment bridge invalid: ${b.issues[0]}`)
  return b
}
function curve(w: WeakBus, s: 'none' | 'svc' | 'statcom'): PvCurve {
  const c = pvCurve(w, s)
  if (!c.ok) throw new Error(c.issues[0])
  return c
}
const pc = (a: number, b: number) => ((a - b) / Math.abs(b)) * 100
const signed = (x: number, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fx(Math.abs(x), d)}`
/** The option id of the multiplier nearest a computed ratio. */
const nearest = (r: number, opts: Array<[string, number]>) => opts.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0]
const dir = (a: number, b: number, tol: number) => (b - a > tol ? 'up' : a - b > tol ? 'down' : 'same')

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'alpha',
    title: 'Raise the firing angle α at constant current',
    layer: 'Converter level',
    change: `One 6-pulse rectifier bridge (${EXP_BRIDGE.vll} kV valve side, X_c = ${EXP_BRIDGE.xc} Ω) carries I_d = 2 kA, held constant by the current controller. Its firing angle is raised from 15° to 35°.`,
    question: 'What happens to the reactive power the converter draws from the AC system?',
    options: [
      { id: 'up', label: 'It rises' },
      { id: 'same', label: 'It stays the same' },
      { id: 'down', label: 'It falls' },
    ],
    run() {
      const b = bridge(15, 2)
      const a = bridge(35, 2)
      return {
        answer: dir(b.q, a.q, 0.5),
        beforeLabel: 'α = 15°',
        afterLabel: 'α = 35°',
        rows: [
          { label: 'DC voltage V_d', unit: 'kV', decimals: 1, before: b.vd, after: a.vd },
          { label: 'Power P = V_d·I_d', unit: 'MW', decimals: 0, before: b.p, after: a.p },
          { label: 'Overlap μ', unit: '°', decimals: 2, before: b.muDeg, after: a.muDeg },
          { label: 'Power factor cos φ', unit: '', decimals: 3, before: b.cosPhi, after: a.cosPhi },
          { label: 'Reactive power Q', unit: 'Mvar', decimals: 0, before: b.q, after: a.q },
        ],
        explain: [
          `V_d = V_d0·cos α − (3/π)X_c·I_d falls from ${fx(b.vd, 1)} to ${fx(a.vd, 1)} kV, so at the same 2 kA the power falls from ${fx(b.p, 0)} to ${fx(a.p, 0)} MW (${signed(pc(a.p, b.p))} %).`,
          `The AC current stays about the same size (it is set by I_d), but it is delayed further behind the voltage: cos φ ≈ ½[cos α + cos(α+μ)] falls from ${fx(b.cosPhi, 3)} to ${fx(a.cosPhi, 3)}. The apparent power S ≈ V_d0·I_d = ${fx(b.s, 0)} MVA stays the same in this approximation, so Q = S·sin φ goes from ${fx(b.q, 0)} to ${fx(a.q, 0)} Mvar (${signed(pc(a.q, b.q))} %).`,
          'That is why converters run with α as small as the control margin allows, and why converter stations need large banks of filters and capacitors.',
        ],
      }
    },
  },
  {
    id: 'current',
    title: 'Double the DC current',
    layer: 'Converter level',
    change: 'The same bridge at α = 15°: the DC current is raised from 1 kA to 2 kA.',
    question: 'What happens to the overlap angle μ?',
    options: [
      { id: 'up', label: 'It increases' },
      { id: 'same', label: 'It is unchanged — μ depends only on α' },
      { id: 'down', label: 'It decreases' },
    ],
    run() {
      const b = bridge(15, 1)
      const a = bridge(15, 2)
      return {
        answer: dir(b.muDeg, a.muDeg, 0.01),
        beforeLabel: 'I_d = 1 kA',
        afterLabel: 'I_d = 2 kA',
        rows: [
          { label: 'Overlap μ', unit: '°', decimals: 2, before: b.muDeg, after: a.muDeg },
          { label: 'Overlap term √2·X_c·I_d/V_LL', unit: '', decimals: 4, before: b.k, after: a.k },
          { label: 'Commutation drop (3/π)X_c·I_d', unit: 'kV', decimals: 2, before: b.drop, after: a.drop },
          { label: 'DC voltage V_d', unit: 'kV', decimals: 1, before: b.vd, after: a.vd },
          { label: 'Reactive power Q', unit: 'Mvar', decimals: 0, before: b.q, after: a.q },
        ],
        explain: [
          `Commutation moves the current from one valve to the next through the reactance X_c; a bigger current takes longer to move. cos(α + μ) = cos α − √2·X_c·I_d/V_LL: the overlap term doubles (${fx(b.k, 4)} → ${fx(a.k, 4)}) and μ grows from ${fx(b.muDeg, 2)}° to ${fx(a.muDeg, 2)}° (×${fx(a.muDeg / b.muDeg, 2)} — not ×2, because of the cosine).`,
          `The voltage lost during overlap, (3/π)X_c·I_d, doubles exactly: ${fx(b.drop, 2)} → ${fx(a.drop, 2)} kV. It acts like a resistance of (3/π)X_c = ${fx((3 / Math.PI) * EXP_BRIDGE.xc, 2)} Ω — but it dissipates nothing.`,
        ],
      }
    },
  },
  {
    id: 'series',
    title: 'Series compensation: 50 %',
    layer: 'AC power flow',
    change: 'A lossless line with X = 0.5 pu and 1.0 pu at both ends gets series capacitors that cancel half of its reactance (k = 0.5).',
    question: 'By how much does the maximum power the line can carry change?',
    options: [
      { id: 'x1', label: 'Unchanged' },
      { id: 'x1.5', label: '×1.5' },
      { id: 'x2', label: '×2' },
      { id: 'x4', label: '×4' },
    ],
    run() {
      const b = pMaxSeries(1, 1, 0.5, 0)
      const a = pMaxSeries(1, 1, 0.5, 0.5)
      const r = a / b
      return {
        answer: nearest(r, [
          ['x1', 1],
          ['x1.5', 1.5],
          ['x2', 2],
          ['x4', 4],
        ]),
        beforeLabel: 'Uncompensated',
        afterLabel: 'k = 50 %',
        rows: [
          { label: 'Effective reactance X(1 − k)', unit: 'pu', decimals: 3, before: 0.5, after: 0.5 * (1 - 0.5) },
          { label: 'P_max = V²/X_eff', unit: 'pu', decimals: 3, before: b, after: a },
          { label: 'Angle needed for 1.0 pu', unit: '°', decimals: 1, before: (Math.asin(1 / b) * 180) / Math.PI, after: (Math.asin(1 / a) * 180) / Math.PI },
        ],
        explain: [
          `The capacitors cancel half the series reactance: X_eff = 0.5 × (1 − 0.5) = ${fx(0.25, 3)} pu. Since P = V_s·V_r·sin δ / X_eff, the whole power–angle curve scales by 1/(1 − k): P_max goes from ${fx(b, 3)} to ${fx(a, 3)} pu, ×${fx(r, 2)}.`,
          `Carrying 1.0 pu now needs a smaller angle (${fx((Math.asin(1 / a) * 180) / Math.PI, 1)}° instead of ${fx((Math.asin(1 / b) * 180) / Math.PI, 1)}°), which leaves more stability margin.`,
        ],
      }
    },
  },
  {
    id: 'shunt',
    title: 'Hold the midpoint voltage with a shunt compensator',
    layer: 'AC power flow · reactive support',
    change: 'The same line (X = 0.5 pu, 1.0 pu at both ends) gets an ideal shunt compensator at its midpoint that holds the midpoint voltage at 1.0 pu.',
    question: 'By how much does the maximum transferable power change?',
    options: [
      { id: 'x1', label: 'Unchanged' },
      { id: 'x1.41', label: '×1.41 (√2)' },
      { id: 'x2', label: '×2' },
      { id: 'x4', label: '×4' },
    ],
    run() {
      const b = pMaxSeries(1, 1, 0.5, 0)
      const a = pMaxMidShunt(1, 0.5)
      const r = a / b
      return {
        answer: nearest(r, [
          ['x1', 1],
          ['x1.41', Math.SQRT2],
          ['x2', 2],
          ['x4', 4],
        ]),
        beforeLabel: 'Uncompensated',
        afterLabel: 'Midpoint held',
        rows: [
          { label: 'P_max', unit: 'pu', decimals: 3, before: b, after: a },
          { label: 'Angle at P_max', unit: '°', decimals: 0, before: 90, after: 180 },
          { label: 'Compensator Q at P_max', unit: 'pu', decimals: 2, before: 0, after: qMidShunt(1, 0.5, 180) },
        ],
        explain: [
          `Holding the midpoint splits the line into two halves of X/2, each carrying half the angle: P = (V²/(X/2))·sin(δ/2) = (2V²/X)·sin(δ/2). Its maximum, ${fx(a, 3)} pu, is reached at δ = 180° — ×${fx(r, 2)} the uncompensated ${fx(b, 3)} pu.`,
          `It is not free: at δ = 180° the compensator must supply (4V²/X)(1 − cos 90°) = ${fx(qMidShunt(1, 0.5, 180), 2)} pu of reactive power. Real installations stop well short of that angle.`,
        ],
      }
    },
  },
  {
    id: 'svc-statcom',
    title: 'Voltage dip: SVC or STATCOM?',
    layer: 'Reactive support',
    change: 'An SVC and a STATCOM are both rated 0.5 pu (capacitive) at 1.0 pu voltage. A disturbance pulls the bus voltage down to 0.7 pu and both go to their capacitive limit.',
    question: 'Which one now delivers more reactive power?',
    options: [
      { id: 'svc', label: 'The SVC' },
      { id: 'statcom', label: 'The STATCOM' },
      { id: 'same', label: 'Both the same — they have the same rating' },
    ],
    run() {
      const s1 = qAtLimit('svc', 0.5, 1)
      const s7 = qAtLimit('svc', 0.5, 0.7)
      const t1 = qAtLimit('statcom', 0.5, 1)
      const t7 = qAtLimit('statcom', 0.5, 0.7)
      return {
        answer: Math.abs(t7 - s7) < 1e-9 ? 'same' : t7 > s7 ? 'statcom' : 'svc',
        beforeLabel: 'SVC',
        afterLabel: 'STATCOM',
        rows: [
          { label: 'Q at 1.0 pu voltage', unit: 'pu', decimals: 3, before: s1, after: t1 },
          { label: 'Q at 0.7 pu voltage', unit: 'pu', decimals: 3, before: s7, after: t7 },
          { label: 'Share of the rating kept', unit: '%', decimals: 0, before: (s7 / s1) * 100, after: (t7 / t1) * 100 },
        ],
        explain: [
          `At its limit the SVC is just a fixed capacitor: Q = B·V² = 0.5 × 0.7² = ${fx(s7, 3)} pu — ${fx((s7 / s1) * 100, 0)} % of its rating, falling with the square of the voltage.`,
          `The STATCOM is a voltage-source converter limited by its current: Q = I_max·V = 0.5 × 0.7 = ${fx(t7, 3)} pu — ${fx((t7 / t1) * 100, 0)} % of its rating, ${fx(t7 / s7, 2)}× the SVC. When the voltage sags and support matters most, the STATCOM gives more.`,
        ],
      }
    },
  },
  {
    id: 'scr',
    title: 'A weaker AC system',
    layer: 'Reactive support · voltage stability',
    change: `A load bus (power factor ${WEAK0.pf} lagging, no compensation) is fed from a system whose short-circuit ratio falls from 5 to 2 — a weaker system with a larger Thevenin reactance.`,
    question: 'What happens to the load at which the bus voltage collapses?',
    options: [
      { id: 'higher', label: 'It rises' },
      { id: 'same', label: 'It does not change' },
      { id: 'lower', label: 'It falls' },
    ],
    run() {
      const wb = { ...WEAK0, scr: 5 }
      const wa = { ...WEAK0, scr: 2 }
      const cb = curve(wb, 'none')
      const ca = curve(wa, 'none')
      const vAt = (w: WeakBus) => {
        const r = solveBus({ ...w, p: 0.5 }, 'none')
        if (!r.ok) throw new Error(r.issues[0])
        return r.v
      }
      return {
        answer: dir(cb.nose.p, ca.nose.p, 1e-6) === 'up' ? 'higher' : dir(cb.nose.p, ca.nose.p, 1e-6) === 'down' ? 'lower' : 'same',
        beforeLabel: 'SCR = 5',
        afterLabel: 'SCR = 2',
        rows: [
          { label: 'Thevenin reactance X = 1/SCR', unit: 'pu', decimals: 3, before: xTh(5), after: xTh(2) },
          { label: 'Collapse load (nose) P_max', unit: 'pu', decimals: 3, before: cb.nose.p, after: ca.nose.p },
          { label: 'Voltage at the nose', unit: 'pu', decimals: 3, before: cb.nose.v, after: ca.nose.v },
          { label: 'Bus voltage at 0.5 pu load', unit: 'pu', decimals: 3, before: vAt(wb), after: vAt(wa) },
        ],
        explain: [
          `The nose of the P–V curve is P_max = E²/(2X(tan φ + sec φ)) with tan φ = ${fx(tanPhi(WEAK0.pf), 3)}: it is inversely proportional to X. With X from ${fx(xTh(5), 3)} to ${fx(xTh(2), 3)} pu the collapse load falls from ${fx(cb.nose.p, 3)} to ${fx(ca.nose.p, 3)} pu (${signed(pc(ca.nose.p, cb.nose.p), 0)} %).`,
          `Even far from collapse the weak system sags more: at 0.5 pu load the bus is at ${fx(vAt(wb), 3)} pu with SCR 5 but ${fx(vAt(wa), 3)} pu with SCR 2. Weak AC systems are where SVCs and STATCOMs earn their keep.`,
        ],
      }
    },
  },
]
